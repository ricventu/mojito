import { describe, it, expect, vi } from "vitest";
import { closeSession } from "@/server/tmux";

function fakeDeps(over: Record<string, unknown> = {}) {
  let alive = true;
  let clock = 0;
  return {
    alive: () => alive,
    hasSession: vi.fn(async () => alive),
    sendKeys: vi.fn(async (_name: string, keys: string) => {
      if (keys === "C-d") alive = false; // graceful exit lands
    }),
    killSession: vi.fn(async () => {
      alive = false;
    }),
    sleep: vi.fn(async (ms: number) => {
      clock += ms;
    }),
    now: () => clock,
    ...over,
  };
}

describe("closeSession", () => {
  it("interrupts then sends EOF and returns without force-killing", async () => {
    const d = fakeDeps();
    const res = await closeSession("mojito-RIC-107-todo", d);

    expect(d.sendKeys).toHaveBeenNthCalledWith(1, "mojito-RIC-107-todo", "C-c");
    expect(d.sendKeys).toHaveBeenNthCalledWith(2, "mojito-RIC-107-todo", "C-d");
    expect(d.killSession).not.toHaveBeenCalled();
    expect(res).toEqual({ closed: true, forced: false });
  });

  it("force-kills after the timeout when claude never exits", async () => {
    // sendKeys does NOT flip alive: simulate a stuck claude that ignores EOF
    const d = fakeDeps({ sendKeys: vi.fn(async () => {}) });
    const res = await closeSession("mojito-RIC-107-todo", d, 1000, 250);

    expect(d.sendKeys).toHaveBeenCalledTimes(2);
    expect(d.killSession).toHaveBeenCalledWith("mojito-RIC-107-todo");
    expect(res).toEqual({ closed: true, forced: true });
  });

  it("no-ops when the session is already gone", async () => {
    const d = fakeDeps({ hasSession: vi.fn(async () => false) });
    const res = await closeSession("mojito-RIC-107-todo", d);

    expect(d.sendKeys).not.toHaveBeenCalled();
    expect(d.killSession).not.toHaveBeenCalled();
    expect(res).toEqual({ closed: true, forced: false });
  });
});
