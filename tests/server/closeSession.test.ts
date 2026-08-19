import { describe, it, expect, vi } from "vitest";
import { closeSession } from "@/server/tmux";

/**
 * A fake claude that exits after `edsToExit` Ctrl-D presses. One is the plain
 * shell case; two is claude's own TUI, which answers the first Ctrl-D with
 * "Press Ctrl-D again to exit" and stays up until the second one arrives.
 */
function fakeDeps(edsToExit = 1, over: Record<string, unknown> = {}) {
  let alive = true;
  let eds = 0;
  let clock = 0;
  return {
    alive: () => alive,
    hasSession: vi.fn(async () => alive),
    sendKeys: vi.fn(async (_name: string, keys: string) => {
      if (keys !== "C-d") return;
      eds += 1;
      if (eds >= edsToExit) alive = false; // graceful exit lands
    }),
    sleep: vi.fn(async (ms: number) => {
      clock += ms;
    }),
    now: () => clock,
    ...over,
  };
}

describe("closeSession", () => {
  it("interrupts then sends EOF and returns once the session is gone", async () => {
    const d = fakeDeps();
    const res = await closeSession("mojito-RIC-107-todo", d);

    expect(d.sendKeys).toHaveBeenNthCalledWith(1, "mojito-RIC-107-todo", "C-c");
    expect(d.sendKeys).toHaveBeenNthCalledWith(2, "mojito-RIC-107-todo", "C-d");
    expect(res).toEqual({ closed: true });
  });

  it("sends the second Ctrl-D claude asks for", async () => {
    // claude answers the first Ctrl-D with "Press Ctrl-D again to exit" and stays
    // up. Sending EOF once and then only watching meant claude never exited, the
    // wait ran to its end, and the session was torn down under a live claude —
    // which is what "it gets killed badly" looked like from the console.
    const d = fakeDeps(2);
    const res = await closeSession("mojito-RIC-107-todo", d, 10_000, 250);

    expect(d.sendKeys.mock.calls.filter(([, k]) => k === "C-d").length).toBeGreaterThanOrEqual(2);
    expect(res).toEqual({ closed: true });
    expect(d.alive()).toBe(false);
    // Exited on the second press, long before the wait was up.
    expect(d.now()).toBeLessThan(10_000);
  });

  it("never force-kills: reports a session claude would not leave", async () => {
    // A session is Mojito's to remove only once claude has actually exited. One
    // that ignores every signal keeps its tmux, its registration and its card —
    // tearing it down here would lose whatever claude had not written out yet.
    const d = fakeDeps(1, { sendKeys: vi.fn(async () => {}) });
    const res = await closeSession("mojito-RIC-107-todo", d, 1000, 250);

    expect(res).toEqual({ closed: false });
    expect(d.alive()).toBe(true);
  });

  it("no-ops when the session is already gone", async () => {
    const d = fakeDeps(1, { hasSession: vi.fn(async () => false) });
    const res = await closeSession("mojito-RIC-107-todo", d);

    expect(d.sendKeys).not.toHaveBeenCalled();
    expect(res).toEqual({ closed: true });
  });
});
