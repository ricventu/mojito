import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/server/projectStack", () => ({
  listStacks: vi.fn(),
  startStack: vi.fn(),
  stopStack: vi.fn(),
  pullStack: vi.fn(),
  pushStack: vi.fn(),
  resolveStack: vi.fn(),
  currentBranch: vi.fn(),
}));

vi.mock("@/server/launch", () => ({ launchStackResolveSession: vi.fn() }));

import { GET } from "@/app/api/stacks/route";
import { POST as START } from "@/app/api/stacks/[slug]/start/route";
import { POST as STOP } from "@/app/api/stacks/[slug]/stop/route";
import { POST as PULL } from "@/app/api/stacks/[slug]/pull/route";
import { POST as PUSH } from "@/app/api/stacks/[slug]/push/route";
import { POST as RESOLVE } from "@/app/api/stacks/[slug]/resolve/route";
import { listStacks, startStack, stopStack, pullStack, pushStack, resolveStack, currentBranch } from "@/server/projectStack";
import { launchStackResolveSession } from "@/server/launch";
import type { StackRow } from "@/lib/stacks";

const TOKEN = "test-token";
function req(auth = true): Request {
  return new Request("http://localhost/api/stacks", { headers: auth ? { "x-mojito-token": TOKEN } : {} });
}

beforeEach(() => {
  process.env.MOJITO_TOKEN = TOKEN;
  process.env.LINEAR_API_KEY = "k";
  vi.mocked(listStacks).mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("GET /api/stacks", () => {
  it("401 without token", async () => {
    expect((await GET(req(false))).status).toBe(401);
  });
  it("200 with the stack rows", async () => {
    const rows: StackRow[] = [
      { project: "Factorybook", slug: "factorybook", path: "/repo/fb", hasStack: true, status: "stopped", pullable: true, self: false, hasWorktreeScript: false },
    ];
    vi.mocked(listStacks).mockResolvedValue(rows);
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stacks: rows });
  });
});

function preq(slug: string, auth = true) {
  return {
    request: new Request(`http://localhost/api/stacks/${slug}/start`, {
      method: "POST", headers: auth ? { "x-mojito-token": TOKEN } : {},
    }),
    ctx: { params: Promise.resolve({ slug }) },
  };
}

describe("POST /api/stacks/[slug]/start", () => {
  it("401 without token", async () => {
    const { request, ctx } = preq("factorybook", false);
    expect((await START(request, ctx)).status).toBe(401);
  });
  it("200 with status on success", async () => {
    vi.mocked(startStack).mockResolvedValue({ ok: true, status: "running" });
    const { request, ctx } = preq("factorybook");
    const res = await START(request, ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "running" });
  });
  it("maps 404 / 409 from the result", async () => {
    vi.mocked(startStack).mockResolvedValue({ ok: false, error: "no stack", code: 404 });
    expect((await START(...Object.values(preq("lime")) as [Request, never])).status).toBe(404);
    vi.mocked(startStack).mockResolvedValue({ ok: false, error: "already running", code: 409 });
    const res = await START(...Object.values(preq("factorybook")) as [Request, never]);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "already running" });
  });
});

describe("POST /api/stacks/[slug]/stop", () => {
  it("200 with status on success", async () => {
    vi.mocked(stopStack).mockResolvedValue({ ok: true, status: "stopped" });
    const res = await STOP(...Object.values(preq("factorybook")) as [Request, never]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "stopped" });
  });
  it("maps 409 not running", async () => {
    vi.mocked(stopStack).mockResolvedValue({ ok: false, error: "not running", code: 409 });
    expect((await STOP(...Object.values(preq("factorybook")) as [Request, never])).status).toBe(409);
  });
});

function pullReq(slug: string, auth = true): [Request, { params: Promise<{ slug: string }> }] {
  return [
    new Request(`http://localhost/api/stacks/${slug}/pull`, { method: "POST", headers: auth ? { "x-mojito-token": TOKEN } : {} }),
    { params: Promise.resolve({ slug }) },
  ];
}

describe("POST /api/stacks/[slug]/pull", () => {
  it("200 returns the pull result at top level", async () => {
    vi.mocked(pullStack).mockResolvedValue({ ok: true, result: { status: "updated", from: "a", to: "b" } });
    const res = await PULL(...pullReq("factorybook"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "updated", from: "a", to: "b" });
  });
  it("404 for the Mojito self-row", async () => {
    vi.mocked(pullStack).mockResolvedValue({ ok: false, error: "not pullable", code: 404 });
    expect((await PULL(...pullReq("mojito"))).status).toBe(404);
  });
  it("409 diverged with detail", async () => {
    vi.mocked(pullStack).mockResolvedValue({ ok: false, error: "diverged", code: 409, detail: "Not possible to fast-forward" });
    const res = await PULL(...pullReq("factorybook"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "diverged", detail: "Not possible to fast-forward" });
  });
  it("500 failed with detail", async () => {
    vi.mocked(pullStack).mockResolvedValue({ ok: false, error: "failed", code: 500, detail: "network down" });
    expect((await PULL(...pullReq("factorybook"))).status).toBe(500);
  });
});

function resolveReq(slug: string, auth = true): [Request, { params: Promise<{ slug: string }> }] {
  return [
    new Request(`http://localhost/api/stacks/${slug}/resolve`, { method: "POST", headers: auth ? { "x-mojito-token": TOKEN } : {} }),
    { params: Promise.resolve({ slug }) },
  ];
}

describe("POST /api/stacks/[slug]/resolve", () => {
  it("404 when the row is unknown or not pullable", async () => {
    vi.mocked(resolveStack).mockReturnValue(null);
    expect((await RESOLVE(...resolveReq("nope"))).status).toBe(404);
    vi.mocked(resolveStack).mockReturnValue({ project: "Mojito", path: "/repo/mojito", hasStack: false, pullable: false, self: true });
    expect((await RESOLVE(...resolveReq("mojito"))).status).toBe(404);
  });
  it("201 with meta on success", async () => {
    vi.mocked(resolveStack).mockReturnValue({ project: "Factorybook", path: "/repo/fb", hasStack: true, pullable: true, self: false });
    vi.mocked(currentBranch).mockResolvedValue("main");
    vi.mocked(launchStackResolveSession).mockResolvedValue({ ok: true, meta: { id: "mojito-custom-factorybook-abc", kind: "custom" } as never });
    const res = await RESOLVE(...resolveReq("factorybook"));
    expect(res.status).toBe(201);
    expect((await res.json()).meta.id).toBe("mojito-custom-factorybook-abc");
    expect(vi.mocked(launchStackResolveSession).mock.calls[0][0]).toEqual({ projectName: "Factorybook", branch: "main" });
  });
  it("422 when the repo cannot be resolved", async () => {
    vi.mocked(resolveStack).mockReturnValue({ project: "Factorybook", path: "/repo/fb", hasStack: true, pullable: true, self: false });
    vi.mocked(currentBranch).mockResolvedValue("main");
    vi.mocked(launchStackResolveSession).mockResolvedValue({ ok: false, reason: "no-repo" });
    expect((await RESOLVE(...resolveReq("factorybook"))).status).toBe(422);
  });
});

function pushReq(slug: string, auth = true): [Request, { params: Promise<{ slug: string }> }] {
  return [
    new Request(`http://localhost/api/stacks/${slug}/push`, { method: "POST", headers: auth ? { "x-mojito-token": TOKEN } : {} }),
    { params: Promise.resolve({ slug }) },
  ];
}

describe("POST /api/stacks/[slug]/push", () => {
  it("401 without token", async () => {
    expect((await PUSH(...pushReq("factorybook", false))).status).toBe(401);
  });
  it("200 returns the push result at top level", async () => {
    vi.mocked(pushStack).mockResolvedValue({ ok: true, result: { status: "pushed", branch: "main", from: "a", to: "b" } });
    const res = await PUSH(...pushReq("factorybook"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "pushed", branch: "main", from: "a", to: "b" });
  });
  it("404 for an unknown slug", async () => {
    vi.mocked(pushStack).mockResolvedValue({ ok: false, error: "unknown stack", code: 404 });
    expect((await PUSH(...pushReq("nope"))).status).toBe(404);
  });
  it("409 rejected with detail", async () => {
    vi.mocked(pushStack).mockResolvedValue({ ok: false, error: "rejected", code: 409, detail: "! [rejected] main -> main" });
    const res = await PUSH(...pushReq("factorybook"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "rejected", detail: "! [rejected] main -> main" });
  });
  it("500 failed", async () => {
    vi.mocked(pushStack).mockResolvedValue({ ok: false, error: "failed", code: 500, detail: "could not read Username" });
    expect((await PUSH(...pushReq("factorybook"))).status).toBe(500);
  });
});
