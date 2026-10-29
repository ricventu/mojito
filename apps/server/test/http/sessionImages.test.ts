import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
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
    expect(await res.json()).toEqual({ error: "unsupported type: image/heic" });
    expect(() => readdirSync(join(stateDir, "images"))).toThrow();
  });

  it("refuses a request with no images", async () => {
    const { post } = withSession();
    const res = await post(form([]));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "no images" });
  });

  it("refuses a field that is not a file", async () => {
    const { post } = withSession();
    const res = await post(form(["not a file"]));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid image" });
  });

  it("answers 404 for an unknown session", async () => {
    const { post } = withSession();
    const res = await post(form([image("a.png", "image/png")]), "mj-RIC-2");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "session not found: mj-RIC-2" });
  });

  it("answers 409 for an ended session", async () => {
    const { post } = withSession("ended");
    const res = await post(form([image("a.png", "image/png")]));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "session ended: mj-RIC-1" });
  });
});
