import { describe, it, expect, beforeEach, vi } from "vitest";

// vi.mock is hoisted above the imports, so every spy has to be hoisted with it.
const h = vi.hoisted(() => ({
  closeSession: vi.fn(async () => ({ closed: true, forced: false })),
  removeSidecar: vi.fn(() => {}),
  cleanupPastedImages: vi.fn(() => {}),
  clearTicketAssets: vi.fn(() => {}),
  registryGet: vi.fn((_id: string) => undefined as unknown),
  registryRemove: vi.fn((_id: string) => {}),
}));

vi.mock("@/server/tmux", () => ({ closeSession: h.closeSession }));
vi.mock("@/server/sidecar", () => ({ removeSidecar: h.removeSidecar }));
vi.mock("@/server/pasteImageStore", () => ({ cleanupPastedImages: h.cleanupPastedImages }));
vi.mock("@/server/ticketAssets", () => ({ clearTicketAssets: h.clearTicketAssets }));
vi.mock("@/server/app", () => ({
  getConfig: () => ({ token: "test-token", stateDir: "/state", port: 4711 }),
  getRegistry: () => ({ get: h.registryGet, remove: h.registryRemove }),
}));

import { DELETE } from "@/app/api/sessions/[id]/route";

const TOKEN = "test-token";
function req(auth = true): Request {
  return new Request("http://localhost/api/sessions/mojito-RIC-46-work", {
    method: "DELETE",
    headers: auth ? { "x-mojito-token": TOKEN } : {},
  });
}
const params = (id = "mojito-RIC-46-work") => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  h.registryGet.mockImplementation(() => undefined);
});

describe("DELETE /api/sessions/[id]", () => {
  it("401 without a token", async () => {
    const res = await DELETE(req(false), params());
    expect(res.status).toBe(401);
    expect(h.closeSession).not.toHaveBeenCalled();
  });

  it("clears the session's downloaded assets alongside the sidecar and registry entry", async () => {
    const res = await DELETE(req(), params("mojito-RIC-46-work"));
    expect(res.status).toBe(204);
    expect(h.closeSession).toHaveBeenCalledWith("mojito-RIC-46-work");
    expect(h.registryRemove).toHaveBeenCalledWith("mojito-RIC-46-work");
    expect(h.removeSidecar).toHaveBeenCalledWith("/state", "mojito-RIC-46-work");
    expect(h.clearTicketAssets).toHaveBeenCalledWith("/state", "mojito-RIC-46-work");
  });

  it("stays best-effort: a throwing clearTicketAssets still lets the delete complete", async () => {
    h.clearTicketAssets.mockImplementation(() => { throw new Error("disk error"); });
    const res = await DELETE(req(), params("mojito-RIC-46-work"));
    expect(res.status).toBe(204);
  });

  it("cleans up pasted images too when the session has a known cwd", async () => {
    h.registryGet.mockImplementation(() => ({ cwd: "/code/mojito/.worktrees/ric-46" }));
    await DELETE(req(), params("mojito-RIC-46-work"));
    expect(h.cleanupPastedImages).toHaveBeenCalledWith("/code/mojito/.worktrees/ric-46", "mojito-RIC-46-work");
  });
});
