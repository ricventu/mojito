import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { claimUpgrades, dropForeignUpgradeListeners } from "@/server/nextUpgrade";

describe("claimUpgrades", () => {
  it("marks Next's one-shot websocket setup done without giving it a server", () => {
    // Next's setupWebSocketHandler(customServer, req) attaches its listener to
    // `customServer || req.socket.server`. Called with neither, it flips its flag and
    // attaches nothing — which is the whole point: with no listener of its own, Next
    // never gets to end a socket we have already upgraded.
    const app = { setupWebSocketHandler: vi.fn() };
    expect(claimUpgrades(app)).toBe(true);
    expect(app.setupWebSocketHandler).toHaveBeenCalledWith();
  });

  it("reports failure when the internal is not there any more", () => {
    expect(claimUpgrades({})).toBe(false);
    expect(claimUpgrades(null)).toBe(false);
  });
});

describe("dropForeignUpgradeListeners", () => {
  it("leaves ours and removes everything else", () => {
    const server = new EventEmitter();
    const ours = vi.fn();
    const theirs = vi.fn();
    server.on("upgrade", ours);
    server.on("upgrade", theirs);

    expect(dropForeignUpgradeListeners(server as never, ours)).toBe(1);

    server.emit("upgrade");
    expect(ours).toHaveBeenCalled();
    expect(theirs).not.toHaveBeenCalled();
  });

  it("is a no-op when ours is the only one", () => {
    const server = new EventEmitter();
    const ours = vi.fn();
    server.on("upgrade", ours);
    expect(dropForeignUpgradeListeners(server as never, ours)).toBe(0);
    expect(server.listenerCount("upgrade")).toBe(1);
  });
});
