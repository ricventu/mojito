import { describe, it, expect, afterAll } from "vitest";
import { tmpdir } from "node:os";
import * as tmux from "@/server/tmux";

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
});
