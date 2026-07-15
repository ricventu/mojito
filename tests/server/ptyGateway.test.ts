import { describe, it, expect, vi } from "vitest";
// node-pty is a native module; the terminal gateway only spawns it on the live
// path, and every test here injects its own spawn, so stub the module to avoid
// loading the native binding under vitest.
vi.mock("node-pty", () => ({ spawn: vi.fn() }));
import { attachPty, type AttachDeps } from "@/server/ptyGateway";
import { SESSION_GONE_CODE } from "@/lib/ptyClose";

/** Minimal WebSocket stand-in capturing the calls attachPty makes. */
function fakeWs() {
  const handlers: Record<string, (...a: unknown[]) => void> = {};
  return {
    on: vi.fn((ev: string, h: (...a: unknown[]) => void) => { handlers[ev] = h; }),
    send: vi.fn(),
    close: vi.fn(),
    emit: (ev: string, ...a: unknown[]) => handlers[ev]?.(...a),
  };
}

// A stand-in for node-pty's IPty; only the members attachPty touches. Cast at
// the injection site since it does not structurally satisfy the full interface.
function fakePty() {
  return { onData: vi.fn(), onExit: vi.fn(), write: vi.fn(), resize: vi.fn(), kill: vi.fn() };
}
const spawnStub = (): AttachDeps["spawn"] => vi.fn(() => fakePty()) as unknown as AttachDeps["spawn"];

describe("attachPty", () => {
  it("never spawns tmux attach for a gone session and closes with SESSION_GONE_CODE", async () => {
    // The bug: attaching to a session that no longer exists (e.g. retired when the
    // ticket auto-advanced) spawned `tmux attach`, which printed "can't find session"
    // and exited — and the client's 1.5s reconnect loop repeated that forever. The
    // gateway must detect the dead session up front and signal a no-retry close.
    const ws = fakeWs();
    const deps: Partial<AttachDeps> = {
      hasSession: vi.fn(async () => false),
      spawn: spawnStub(),
      capturePane: vi.fn(async () => ""),
    };
    attachPty(ws as never, "mojito-RIC-122-backlog", deps);
    await vi.waitFor(() => expect(ws.close).toHaveBeenCalled());

    expect(deps.hasSession).toHaveBeenCalledWith("mojito-RIC-122-backlog");
    expect(deps.spawn).not.toHaveBeenCalled();
    expect(ws.close).toHaveBeenCalledWith(SESSION_GONE_CODE, expect.any(String));
  });

  it("spawns tmux attach for a live session", async () => {
    const ws = fakeWs();
    const deps: Partial<AttachDeps> = {
      hasSession: vi.fn(async () => true),
      spawn: spawnStub(),
      capturePane: vi.fn(async () => "scrollback"),
    };
    attachPty(ws as never, "mojito-RIC-46-to-code", deps);
    await vi.waitFor(() => expect(deps.spawn).toHaveBeenCalled());

    expect(deps.spawn).toHaveBeenCalledWith(
      "tmux",
      ["attach-session", "-t", "mojito-RIC-46-to-code"],
      expect.any(Object),
    );
    expect(ws.close).not.toHaveBeenCalledWith(SESSION_GONE_CODE, expect.any(String));
  });

  it("rejects a missing id without checking tmux", () => {
    const ws = fakeWs();
    const deps: Partial<AttachDeps> = { hasSession: vi.fn(async () => true), spawn: spawnStub() };
    attachPty(ws as never, "", deps);
    expect(deps.hasSession).not.toHaveBeenCalled();
    expect(ws.close).toHaveBeenCalledWith(1008, "missing session");
  });
});
