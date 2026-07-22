import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";

// The route's dependency runs `git pull` (real side effects), so mock the wrapper.
// FfPullError stays real so the route's `instanceof` check works.
vi.mock("@/server/selfUpdate", () => ({
  isSelfUpdateEnabled: vi.fn(),
  runSelfUpdate: vi.fn(),
}));

import { GET, POST } from "@/app/api/self-update/route";
import { isSelfUpdateEnabled, runSelfUpdate } from "@/server/selfUpdate";
import { FfPullError } from "@/server/ffPull";

const TOKEN = "test-token";
function req(method: string, auth = true): Request {
  return new Request("http://localhost/api/self-update", {
    method,
    headers: auth ? { "x-mojito-token": TOKEN } : {},
  });
}

beforeEach(() => {
  process.env.MOJITO_TOKEN = TOKEN;
  process.env.LINEAR_API_KEY = "k";
  vi.mocked(isSelfUpdateEnabled).mockReset();
  vi.mocked(runSelfUpdate).mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("/api/self-update", () => {
  it("401 without a token", async () => {
    vi.mocked(isSelfUpdateEnabled).mockReturnValue(true);
    expect((await GET(req("GET", false))).status).toBe(401);
    expect((await POST(req("POST", false))).status).toBe(401);
  });

  it("GET reports enabled=false when the flag is off", async () => {
    vi.mocked(isSelfUpdateEnabled).mockReturnValue(false);
    const res = await GET(req("GET"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: false });
  });

  it("GET reports enabled=true when the flag is on", async () => {
    vi.mocked(isSelfUpdateEnabled).mockReturnValue(true);
    expect(await (await GET(req("GET"))).json()).toEqual({ enabled: true });
  });

  it("POST returns 404 when the flag is off", async () => {
    vi.mocked(isSelfUpdateEnabled).mockReturnValue(false);
    const res = await POST(req("POST"));
    expect(res.status).toBe(404);
    expect(runSelfUpdate).not.toHaveBeenCalled();
  });

  it("POST returns the pull result on success", async () => {
    vi.mocked(isSelfUpdateEnabled).mockReturnValue(true);
    vi.mocked(runSelfUpdate).mockResolvedValue({ status: "updated", from: "aaa", to: "bbb" });
    const res = await POST(req("POST"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "updated", from: "aaa", to: "bbb" });
  });

  it("POST maps a diverged pull to 409", async () => {
    vi.mocked(isSelfUpdateEnabled).mockReturnValue(true);
    vi.mocked(runSelfUpdate).mockRejectedValue(new FfPullError("diverged", "Not possible to fast-forward"));
    const res = await POST(req("POST"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "diverged", detail: "Not possible to fast-forward" });
  });

  it("POST maps a generic git failure to 500", async () => {
    vi.mocked(isSelfUpdateEnabled).mockReturnValue(true);
    vi.mocked(runSelfUpdate).mockRejectedValue(new FfPullError("failed", "fatal: not a git repository"));
    const res = await POST(req("POST"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "failed", detail: "fatal: not a git repository" });
  });
});
