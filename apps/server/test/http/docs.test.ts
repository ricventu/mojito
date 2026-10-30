import { describe, expect, it, vi } from "vitest";
import type { DocList } from "@mojito/shared";
import type { DocFileResult } from "../../src/docs/file";
import { GitError } from "../../src/git/git";
import { setup } from "./setup";

const web = { name: "Web", path: "~/repo/web", teamKey: "RIC" };
const spaced = { name: "My Web", path: "~/repo/my-web", teamKey: "RIC" };
const list: DocList = { docs: [{ path: "a.md", mtime: "2026-10-30T10:00:00.000Z", size: 3 }], ticketDocs: [] };
const found: DocFileResult = { ok: true, file: { path: "a.md", content: "# a\n" } };

function withReader(over: { list?: () => Promise<DocList>; file?: () => Promise<DocFileResult> } = {}) {
  const docsRead = {
    list: vi.fn(async (_cwd: string, _ticket: string | null) => list),
    file: vi.fn(async (_cwd: string, _path: string, _ticket: string | null) => found),
    ...over,
  };
  const ctx = setup({ docsRead: docsRead as never });
  ctx.projects.upsert(web);
  ctx.projects.upsert(spaced);
  return { ...ctx, docsRead };
}

const base = "/api/projects/Web/docs";

describe("GET /api/projects/:name/docs", () => {
  it("lists the documents of the expanded checkout, with the ticket", async () => {
    const ctx = withReader();
    const res = await ctx.req(base);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(list);
    expect(ctx.docsRead.list).toHaveBeenCalledWith("/home/me/repo/web", null);
    await ctx.req(`${base}?ticket=RIC-5`);
    expect(ctx.docsRead.list).toHaveBeenLastCalledWith("/home/me/repo/web", "RIC-5");
  });

  it("finds a project whose name has a space", async () => {
    const ctx = withReader();
    const res = await ctx.req("/api/projects/My%20Web/docs");
    expect(res.status).toBe(200);
    expect(ctx.docsRead.list).toHaveBeenCalledWith("/home/me/repo/my-web", null);
  });

  it.each(["ticket=../x", "ticket="])("refuses %s without reading", async (q) => {
    const ctx = withReader();
    const res = await ctx.req(`${base}?${q}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid ticket" });
    expect(ctx.docsRead.list).not.toHaveBeenCalled();
  });

  it("404s an unknown project, 400s a path missing on disk", async () => {
    const ctx = withReader();
    expect((await ctx.req("/api/projects/Nope/docs")).status).toBe(404);
    ctx.exists.mockReturnValue(false);
    const res = await ctx.req(base);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "project path not found: /home/me/repo/web" });
    expect(ctx.docsRead.list).not.toHaveBeenCalled();
  });

  it("answers git's own message, cut at 500 characters, as a 409", async () => {
    const ctx = withReader({
      list: async () => {
        throw new GitError(["ls-files"], `fatal: not a git repository${"x".repeat(900)}`, 128);
      },
    });
    const res = await ctx.req(base);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toHaveLength(500);
    expect(body.error.startsWith("fatal: not a git repository")).toBe(true);
  });

  it("is behind the token", async () => {
    const ctx = withReader();
    expect((await ctx.app.request(base)).status).toBe(401);
    expect(ctx.docsRead.list).not.toHaveBeenCalled();
  });
});

describe("GET /api/projects/:name/docs/file", () => {
  it("answers the document, read with the path and the ticket", async () => {
    const ctx = withReader();
    const res = await ctx.req(`${base}/file?path=docs%2Fa.md&ticket=RIC-5`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ path: "a.md", content: "# a\n" });
    expect(ctx.docsRead.file).toHaveBeenCalledWith("/home/me/repo/web", "docs/a.md", "RIC-5");
  });

  it.each(["", "?path=", "?path=a.md&ticket=x"])("400s %j without reading", async (q) => {
    const ctx = withReader();
    const res = await ctx.req(`${base}/file${q}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: expect.any(String) });
    expect(ctx.docsRead.file).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid", 400, "not a markdown file in this project"],
    ["not-found", 404, "document not found"],
    ["too-large", 413, "document too large"],
  ] as const)("maps %s to %i", async (reason, status, error) => {
    const ctx = withReader({ file: async () => ({ ok: false, reason }) });
    const res = await ctx.req(`${base}/file?path=a.md`);
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error });
  });

  it("is behind the token", async () => {
    const ctx = withReader();
    expect((await ctx.app.request(`${base}/file?path=a.md`)).status).toBe(401);
  });
});
