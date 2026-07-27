import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/server/docTarget", () => ({
  resolveDocsTarget: vi.fn(),
  // The routes call this for the production wiring; the mocked resolver ignores it.
  docsDeps: vi.fn(() => ({ session: () => undefined, projectsPath: "/projects.json" })),
}));
vi.mock("@/server/docFiles", () => ({
  listDocs: vi.fn(),
  resolveDocPath: vi.fn(),
  readDoc: vi.fn(),
}));

import { GET as LIST } from "@/app/api/docs/route";
import { GET as CONTENT } from "@/app/api/docs/content/route";
import { resolveDocsTarget } from "@/server/docTarget";
import { listDocs, resolveDocPath, readDoc } from "@/server/docFiles";

const TOKEN = "test-token";
function req(qs: string, auth = true): Request {
  return new Request(`http://localhost/api/docs?${qs}`, {
    headers: auth ? { "x-mojito-token": TOKEN } : {},
  });
}

beforeEach(() => {
  process.env.MOJITO_TOKEN = TOKEN;
  process.env.LINEAR_API_KEY = "k";
  vi.mocked(resolveDocsTarget).mockReset();
  vi.mocked(listDocs).mockReset();
  vi.mocked(resolveDocPath).mockReset();
  vi.mocked(readDoc).mockReset();
});
afterEach(() => vi.restoreAllMocks());

const okTarget = { ok: true as const, root: "/wt/RIC-162", label: "RIC-162" };

describe("GET /api/docs", () => {
  it("401 without the token", async () => {
    expect((await LIST(req("session=s", false))).status).toBe(401);
  });

  it("200 with root, label and files", async () => {
    vi.mocked(resolveDocsTarget).mockReturnValue(okTarget);
    const files = [{ path: "docs/a.md", name: "a.md", source: "specs", mtime: "2026-07-27T12:00:00.000Z", size: 3 }];
    vi.mocked(listDocs).mockReturnValue(files as never);
    const res = await LIST(req("session=s"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ root: "/wt/RIC-162", label: "RIC-162", files });
    expect(vi.mocked(listDocs).mock.calls[0][0]).toBe("/wt/RIC-162");
  });

  it("passes the target's error code through", async () => {
    vi.mocked(resolveDocsTarget).mockReturnValue({ ok: false, error: "no worktree for this ticket", code: 409 });
    const res = await LIST(req("ticket=RIC-1"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "no worktree for this ticket" });
  });
});

describe("GET /api/docs/content", () => {
  it("401 without the token", async () => {
    expect((await CONTENT(req("session=s&path=docs/a.md", false))).status).toBe(401);
  });

  it("400 without a path", async () => {
    vi.mocked(resolveDocsTarget).mockReturnValue(okTarget);
    expect((await CONTENT(req("session=s"))).status).toBe(400);
  });

  it("400 when the path is rejected by the guard", async () => {
    vi.mocked(resolveDocsTarget).mockReturnValue(okTarget);
    vi.mocked(resolveDocPath).mockReturnValue(null);
    const res = await CONTENT(req("session=s&path=../escape.md"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid path" });
  });

  it("200 with the file content", async () => {
    vi.mocked(resolveDocsTarget).mockReturnValue(okTarget);
    vi.mocked(resolveDocPath).mockReturnValue("/wt/RIC-162/docs/a.md");
    vi.mocked(readDoc).mockReturnValue({ ok: true, content: "# a" });
    const res = await CONTENT(req("session=s&path=docs/a.md"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ path: "docs/a.md", content: "# a" });
    expect(vi.mocked(resolveDocPath).mock.calls[0]).toEqual(["/wt/RIC-162", "docs/a.md"]);
  });

  it("404 when the file is gone", async () => {
    vi.mocked(resolveDocsTarget).mockReturnValue(okTarget);
    vi.mocked(resolveDocPath).mockReturnValue("/wt/RIC-162/docs/a.md");
    vi.mocked(readDoc).mockReturnValue({ ok: false, reason: "not-found" });
    const res = await CONTENT(req("session=s&path=docs/a.md"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "document not found" });
  });

  it("413 when the file is over the cap", async () => {
    vi.mocked(resolveDocsTarget).mockReturnValue(okTarget);
    vi.mocked(resolveDocPath).mockReturnValue("/wt/RIC-162/docs/big.md");
    vi.mocked(readDoc).mockReturnValue({ ok: false, reason: "too-large" });
    const res = await CONTENT(req("session=s&path=docs/big.md"));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "document too large" });
  });
});
