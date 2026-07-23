import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/server/projectStack", () => ({
  listStacks: vi.fn(),
  startStack: vi.fn(),
  stopStack: vi.fn(),
  pullStack: vi.fn(),
  resolveStack: vi.fn(),
  currentBranch: vi.fn(),
}));

import { GET } from "@/app/api/stacks/route";
import { POST as START } from "@/app/api/stacks/[slug]/start/route";
import { POST as STOP } from "@/app/api/stacks/[slug]/stop/route";
import { listStacks, startStack, stopStack } from "@/server/projectStack";

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
    const rows = [{ project: "Factorybook", slug: "factorybook", hasStack: true, status: "stopped", pullable: true }];
    vi.mocked(listStacks).mockResolvedValue(rows as never);
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
