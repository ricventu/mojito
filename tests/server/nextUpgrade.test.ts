import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { claimUpgrades, dropForeignUpgradeListeners, nextUpgradeHandler } from "@/server/nextUpgrade";

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

describe("nextUpgradeHandler", () => {
  it("prefers the internal getter over the public method", () => {
    // The public getUpgradeHandler() resolves to the inner server's no-op in dev, so
    // handing it /_next/hmr drops Fast Refresh on the floor. The `upgradeHandler`
    // property is the router server's, and the only one that answers HMR.
    const internal = vi.fn();
    const publicOne = vi.fn();
    const app = { upgradeHandler: internal, getUpgradeHandler: () => publicOne };

    nextUpgradeHandler(app)(...args());

    expect(internal).toHaveBeenCalled();
    expect(publicOne).not.toHaveBeenCalled();
  });

  it("calls the internal getter with the app as its receiver", () => {
    // It is a getter off the dev wrapper and reads `this.getInit()`, so an unbound
    // reference throws. Bound, `this` is the app.
    let seen: string | undefined;
    const app = {
      marker: "the app",
      upgradeHandler(this: { marker: string }) {
        seen = this?.marker;
      },
      getUpgradeHandler: () => vi.fn(),
    };

    nextUpgradeHandler(app)(...args());

    expect(seen).toBe("the app");
  });

  it("falls back to the public method when the internal is gone", () => {
    const publicOne = vi.fn();
    const app = { getUpgradeHandler: () => publicOne };

    nextUpgradeHandler(app)(...args());

    expect(publicOne).toHaveBeenCalled();
  });
});

/** A throwaway (req, socket, head) triple — nothing here reads them. */
function args() {
  return [{}, {}, Buffer.alloc(0)] as unknown as [never, never, never];
}
