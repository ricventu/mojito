import { describe, it, expect, beforeEach, vi } from "vitest";

// vi.mock is hoisted above the imports, so every spy has to be hoisted with it.
const h = vi.hoisted(() => ({
  closeSession: vi.fn(async () => ({ closed: true })),
  removeSidecar: vi.fn(() => {}),
  cleanupPastedImages: vi.fn(() => {}),
  clearTicketAssets: vi.fn(() => {}),
  registryGet: vi.fn((_id: string) => undefined as unknown),
  registryRemove: vi.fn((_id: string) => {}),
  registryPatch: vi.fn((_id: string, _p: unknown) => undefined as unknown),
  emit: vi.fn((_e: unknown) => {}),
}));

vi.mock("@/server/tmux", () => ({ closeSession: h.closeSession }));
vi.mock("@/server/sidecar", () => ({ removeSidecar: h.removeSidecar }));
vi.mock("@/server/pasteImageStore", () => ({ cleanupPastedImages: h.cleanupPastedImages }));
vi.mock("@/server/ticketAssets", () => ({ clearTicketAssets: h.clearTicketAssets }));
vi.mock("@/server/app", () => ({
  getConfig: () => ({ token: "test-token", stateDir: "/state", port: 4711 }),
  getRegistry: () => ({ get: h.registryGet, remove: h.registryRemove, patch: h.registryPatch }),
  getBus: () => ({ emit: h.emit }),
}));

import { DELETE, PATCH } from "@/app/api/sessions/[id]/route";

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
  // clearAllMocks wipes the calls, not the implementations: restore the default
  // "claude exited" so a case that overrides it cannot leak into the next one.
  h.closeSession.mockImplementation(async () => ({ closed: true }));
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

  it("keeps a session claude would not leave, and says so", async () => {
    // No force path anywhere (see closeSession): a session whose claude is still
    // running keeps its tmux, so removing the registration here would strand it —
    // alive, still holding the tmux name, and invisible to Mojito.
    h.closeSession.mockImplementation(async () => ({ closed: false }));
    const res = await DELETE(req(), params("mojito-RIC-46-work"));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: expect.any(String) });
    expect(h.registryRemove).not.toHaveBeenCalled();
    expect(h.removeSidecar).not.toHaveBeenCalled();
    expect(h.clearTicketAssets).not.toHaveBeenCalled();
    expect(h.cleanupPastedImages).not.toHaveBeenCalled();
  });

  it("cleans up pasted images too when the session has a known cwd", async () => {
    h.registryGet.mockImplementation(() => ({ cwd: "/code/mojito/.worktrees/ric-46" }));
    await DELETE(req(), params("mojito-RIC-46-work"));
    expect(h.cleanupPastedImages).toHaveBeenCalledWith("/code/mojito/.worktrees/ric-46", "mojito-RIC-46-work");
  });
});

describe("PATCH /api/sessions/[id]", () => {
  function patchReq(body: unknown, auth = true): Request {
    return new Request("http://localhost/api/sessions/mojito-RIC-46-work", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(auth ? { "x-mojito-token": TOKEN } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  it("401 without a token", async () => {
    const res = await PATCH(patchReq({ hidden: true }, false), params());
    expect(res.status).toBe(401);
    expect(h.registryPatch).not.toHaveBeenCalled();
  });

  it("hides a session, persists it through the registry and tells every client", async () => {
    const meta = { id: "mojito-RIC-46-work", hidden: true };
    h.registryGet.mockImplementation(() => ({ id: "mojito-RIC-46-work" }));
    h.registryPatch.mockImplementation(() => meta);
    const res = await PATCH(patchReq({ hidden: true }), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(meta);
    expect(h.registryPatch).toHaveBeenCalledWith("mojito-RIC-46-work", { hidden: true });
    // Another device's sidebar learns of it only through the bus.
    expect(h.emit).toHaveBeenCalledWith({ type: "session.updated", id: "mojito-RIC-46-work" });
  });

  it("unhides one", async () => {
    h.registryGet.mockImplementation(() => ({ id: "mojito-RIC-46-work", hidden: true }));
    h.registryPatch.mockImplementation(() => ({ id: "mojito-RIC-46-work", hidden: false }));
    const res = await PATCH(patchReq({ hidden: false }), params());
    expect(res.status).toBe(200);
    expect(h.registryPatch).toHaveBeenCalledWith("mojito-RIC-46-work", { hidden: false });
  });

  it("404 for a session Mojito has no registration for", async () => {
    // Registry.patch would fall back to a sidecar on disk; a session the registry does
    // not hold is not one the sidebar can show, so it must not be resurrected here.
    const res = await PATCH(patchReq({ hidden: true }), params("mojito-nope"));
    expect(res.status).toBe(404);
    expect(h.registryPatch).not.toHaveBeenCalled();
    expect(h.emit).not.toHaveBeenCalled();
  });

  it.each([
    ["a non-boolean", { hidden: "yes" }],
    ["a missing flag", {}],
    ["any other field", { hidden: true, state: "done" }],
    ["a non-object", [true]],
    ["malformed json", "{"],
  ])("400 for %s", async (_label, body) => {
    h.registryGet.mockImplementation(() => ({ id: "mojito-RIC-46-work" }));
    const res = await PATCH(patchReq(body), params());
    expect(res.status).toBe(400);
    expect(h.registryPatch).not.toHaveBeenCalled();
  });
});
