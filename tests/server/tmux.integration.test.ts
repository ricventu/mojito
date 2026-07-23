import { describe, it, expect, afterAll } from "vitest";
import { tmpdir } from "node:os";
import * as tmux from "@/server/tmux";
import { startStackSession, panesDead } from "@/server/tmux";

const run = tmux.tmuxAvailable() ? describe : describe.skip;
const NAME = "mojito-test-ric-1-integration";

run("tmux control (requires tmux)", () => {
  afterAll(async () => {
    if (await tmux.hasSession(NAME)) await tmux.killSession(NAME);
  });

  it("creates, detects, lists, captures, and kills a session", async () => {
    await tmux.newSession(NAME, tmpdir(), "printf 'hello-mojito\\n'; sleep 30");
    expect(await tmux.hasSession(NAME)).toBe(true);
    expect(await tmux.listSessions("mojito-test-")).toContain(NAME);
    await new Promise((r) => setTimeout(r, 300));
    expect(await tmux.capturePane(NAME, 50)).toContain("hello-mojito");
    await tmux.killSession(NAME);
    expect(await tmux.hasSession(NAME)).toBe(false);
  });

  it("closeSession interrupts the process and lets the session auto-close (no force)", async () => {
    const CLOSE_NAME = "mojito-test-ric-1-close";
    await tmux.newSession(CLOSE_NAME, tmpdir(), "sleep 30");
    expect(await tmux.hasSession(CLOSE_NAME)).toBe(true);
    // C-c interrupts sleep, the session command exits, and tmux tears the session down.
    const res = await tmux.closeSession(CLOSE_NAME, {}, 8000, 100);
    expect(res).toEqual({ closed: true, forced: false });
    expect(await tmux.hasSession(CLOSE_NAME)).toBe(false);
  });

  it("retains a crashed pane via remain-on-exit and reports pane_dead", async () => {
    const name = "mojito-test-stack-crash";
    await tmux.killSession(name).catch(() => {});
    // A command that exits immediately (non-zero) simulates a crashed stack.
    await startStackSession(name, process.cwd(), "bash -lc 'exit 1'");
    // Give tmux a moment to run and mark the pane dead.
    await new Promise((r) => setTimeout(r, 300));
    expect(await tmux.hasSession(name)).toBe(true); // remain-on-exit kept it
    expect((await panesDead(name)).trim()).toBe("1");
    await tmux.killSession(name);
    expect(await tmux.hasSession(name)).toBe(false);
  });

  it("reports a live pane as not dead", async () => {
    const name = "mojito-test-stack-live";
    await tmux.killSession(name).catch(() => {});
    await startStackSession(name, process.cwd(), "sleep 30");
    await new Promise((r) => setTimeout(r, 200));
    expect((await panesDead(name)).trim()).toBe("0");
    await tmux.killSession(name);
  });
});
