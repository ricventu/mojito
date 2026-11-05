import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TOKEN, cfg, meta, setup } from "./setup";

const image = (name: string, type: string, bytes: number[] = [1, 2, 3]) => new File([new Uint8Array(bytes)], name, { type });

function form(images: (File | string)[]) {
  const fd = new FormData();
  for (const f of images) fd.append("images[]", f);
  return fd;
}

/** The app over a real, empty state directory: the images are written to disk. */
function withSession(state: "running" | "ended" = "running") {
  const stateDir = mkdtempSync(join(tmpdir(), "mj-images-"));
  const s = setup({ cfg: { ...cfg, stateDir } });
  s.sessions.insert(meta({ state }));
  const post = (fd: FormData, id = "mj-RIC-1") =>
    s.app.request(`/api/sessions/${id}/images`, { method: "POST", headers: { "x-mojito-token": TOKEN }, body: fd });
  return { ...s, stateDir, post };
}

describe("POST /api/sessions/:id/images", () => {
  it("writes each image under the state dir and answers with their absolute paths", async () => {
    const { post, stateDir } = withSession();
    const res = await post(form([image("shot.png", "image/png", [9, 8, 7]), image("photo.jpeg", "image/jpeg")]));
    expect(res.status).toBe(201);
    const { paths } = (await res.json()) as { paths: string[] };
    const dir = join(stateDir, "images", "mj-RIC-1");
    expect(paths).toHaveLength(2);
    expect(paths[0]).toMatch(new RegExp(`^${dir}/[0-9a-f]{12}\\.png$`));
    expect(paths[1]).toMatch(new RegExp(`^${dir}/[0-9a-f]{12}\\.jpg$`));
    expect([...readFileSync(paths[0])]).toEqual([9, 8, 7]);
    expect(readdirSync(dir)).toHaveLength(2);
  });

  it("keeps the images private to the user", async () => {
    const { post, stateDir } = withSession();
    const { paths } = (await (await post(form([image("a.png", "image/png")]))).json()) as { paths: string[] };
    expect(statSync(join(stateDir, "images", "mj-RIC-1")).mode & 0o777).toBe(0o700);
    expect(statSync(paths[0]).mode & 0o777).toBe(0o600);
  });

  it("refuses an unsupported type and writes nothing", async () => {
    const { post, stateDir } = withSession();
    const res = await post(form([image("a.png", "image/png"), image("a.heic", "image/heic")]));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unsupported file: a.heic (images and PDF only)" });
    expect(() => readdirSync(join(stateDir, "images"))).toThrow();
  });

  it("keeps a PDF's name, made safe to paste, under the extension it was allowed by", async () => {
    const { post, stateDir } = withSession();
    const res = await post(form([image("Fattura più bella (2026).PDF", "", [37, 80, 68, 70])]));
    expect(res.status).toBe(201);
    const { paths } = (await res.json()) as { paths: string[] };
    expect(paths[0]).toMatch(new RegExp(`^${join(stateDir, "images", "mj-RIC-1")}/Fattura-piu-bella-2026-[0-9a-f]{12}\\.pdf$`));
    expect([...readFileSync(paths[0])]).toEqual([37, 80, 68, 70]);
    expect(statSync(paths[0]).mode & 0o777).toBe(0o600);
  });

  it("refuses a document that is no PDF, and a file too large, naming it", async () => {
    const { post } = withSession();
    const refused = await post(form([image("a.pdf", "application/pdf"), image("sheet.xlsx", "")]));
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: "unsupported file: sheet.xlsx (images and PDF only)" });
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.pdf", { type: "application/pdf" });
    const tooLarge = await post(form([big]));
    expect(tooLarge.status).toBe(400);
    expect(await tooLarge.json()).toEqual({ error: "file too large: big.pdf" });
  });

  it("refuses a request with no files", async () => {
    const { post } = withSession();
    const res = await post(form([]));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "no files" });
  });

  it("refuses a field that is not a file", async () => {
    const { post } = withSession();
    const res = await post(form(["not a file"]));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid file" });
  });

  it("answers 404 for an unknown session", async () => {
    const { post } = withSession();
    const res = await post(form([image("a.png", "image/png")]), "mj-RIC-2");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "session not found: mj-RIC-2" });
  });

  // Answered mid-upload, the server closes the connection after the refusal, and a browser can
  // report a bare network error ("Load failed") instead of it.
  it.each([
    ["an ended session", "mj-RIC-1", 409],
    ["an unknown session", "mj-RIC-2", 404],
  ])("reads the whole upload before refusing %s", async (_label, id, status) => {
    const { app } = withSession(id === "mj-RIC-1" ? "ended" : "running");
    const req = new Request(`http://mojito/api/sessions/${id}/images`, {
      method: "POST",
      headers: { "x-mojito-token": TOKEN },
      body: form([image("a.pdf", "application/pdf")]),
    });
    const res = await app.request(req);
    expect(res.status).toBe(status);
    expect(req.bodyUsed).toBe(true);
  });

  it("answers 409 for an ended session", async () => {
    const { post } = withSession("ended");
    const res = await post(form([image("a.png", "image/png")]));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "session ended: mj-RIC-1" });
  });
});

describe("GET /api/sessions/:id/image", () => {
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3];

  /** A session working in a real temp directory, with a png and a secret in it. */
  function viewing() {
    const cwd = mkdtempSync(join(tmpdir(), "mj-view-"));
    writeFileSync(join(cwd, "shot.png"), Buffer.from(PNG));
    writeFileSync(join(cwd, "env.png"), "MOJITO_TOKEN=secret");
    const s = setup();
    s.sessions.insert(meta({ cwd, state: "ended" }));
    const get = (path: string | null, id = "mj-RIC-1") =>
      s.app.request(`/api/sessions/${id}/image${path === null ? "" : `?path=${encodeURIComponent(path)}`}`, {
        headers: { "x-mojito-token": TOKEN },
      });
    return { cwd, get };
  }

  it("serves the image's bytes as the type they show, even for an ended session", async () => {
    const { get } = viewing();
    const res = await get("shot.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual(PNG);
  });

  it("serves it as an image and nothing else: no sniffing, sandboxed, never cached", async () => {
    const { get, cwd } = viewing();
    const res = await get(join(cwd, "shot.png"));
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("answers 400 for no path or one that names no image", async () => {
    const { get } = viewing();
    expect(await (await get(null)).json()).toEqual({ error: "path is required" });
    for (const bad of [".env", "a.svg", "../shot.png"]) {
      const res = await get(bad);
      expect(res.status, bad).toBe(400);
      expect(await res.json()).toEqual({ error: "not an image path" });
    }
  });

  it("answers 415 for a file whose bytes are no image", async () => {
    const res = await viewing().get("env.png");
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: "not an image" });
  });

  it("answers 404 for a missing file and for an unknown session", async () => {
    const { get } = viewing();
    expect((await get("missing.png")).status).toBe(404);
    const res = await get("shot.png", "mj-RIC-2");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "session not found: mj-RIC-2" });
  });

  it("needs the token", async () => {
    const { cwd } = viewing();
    const res = await setup().app.request(`/api/sessions/mj-RIC-1/image?path=${encodeURIComponent(join(cwd, "shot.png"))}`);
    expect(res.status).toBe(401);
  });
});
