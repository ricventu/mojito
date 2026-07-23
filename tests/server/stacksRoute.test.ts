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
import { listStacks } from "@/server/projectStack";

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
