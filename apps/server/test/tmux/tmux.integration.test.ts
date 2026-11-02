import { describe, it, expect, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import * as tmux from "../../src/tmux/tmux";

const pexec = promisify(execFile);

// Drives a real tmux server, so every session here carries a name no other session can
// have (`mj-test-<rand>`) and is killed in afterEach — nothing else on the server is touched.
describe.skipIf(!tmux.tmuxAvailable())("tmux control (requires tmux)", () => {
  let name = "";
  const fresh = () => (name = `mj-test-${randomBytes(4).toString("hex")}`);

  // Extra sessions a test creates beside `name`; killed by exact name like it.
  let others: string[] = [];

  afterEach(async () => {
    for (const n of [name, ...others]) {
      if (n) await pexec("tmux", ["kill-session", "-t", `=${n}`]).catch(() => {});
    }
    name = "";
    others = [];
  });

  it("creates, detects, lists and captures a session", async () => {
    fresh();
    await tmux.newSession(name, tmpdir(), "printf 'hello-mojito\\n'; sleep 30");
    expect(await tmux.hasSession(name)).toBe(true);
    expect(await tmux.listSessions("mj-test-")).toContain(name);
    await new Promise((r) => setTimeout(r, 300));
    expect(await tmux.capturePane(name, 50)).toContain("hello-mojito");
  });

  it("reads the pane title a program set, per session of the prefix", async () => {
    fresh();
    await tmux.newSession(name, tmpdir(), "printf '\\033]2;✳ pippo-test\\033\\\\'; sleep 30");
    await new Promise((r) => setTimeout(r, 300));
    const panes = await tmux.livePanes("mj-test-");
    expect(panes.get(name)?.title).toBe("✳ pippo-test");
    expect(panes.get(name)?.pid).toBeGreaterThan(0);
    expect([...panes.keys()].every((n) => n.startsWith("mj-test-"))).toBe(true);
  });

  it("refuses to create a second session under a name that is taken", async () => {
    fresh();
    await tmux.newSession(name, tmpdir(), "sleep 30");
    await expect(tmux.newSession(name, tmpdir(), "sleep 30")).rejects.toBeInstanceOf(tmux.DuplicateSessionError);
  });

  // tmux prefix-matches a bare `-t`: with `…-1` gone, `-t …-1` lands on a live `…-12`. Every
  // target Mojito builds is exact, so the sibling is never touched.
  it("targets a session by its exact name, never a live one it is a prefix of", async () => {
    const base = fresh();
    name = `${base}-1`;
    const sibling = `${base}-12`;
    others = [sibling];
    await tmux.newSession(sibling, tmpdir(), "printf 'sibling-12\\n'; cat");
    await tmux.newSession(name, tmpdir(), "printf 'target-1\\n'; cat");
    await new Promise((r) => setTimeout(r, 300));

    const own = await tmux.capturePane(name, 50);
    expect(own).toContain("target-1");
    expect(own).not.toContain("sibling-12");

    // Ctrl-D ends the target's `cat`; a prefix target would have ended the sibling's.
    await tmux.sendKeys(name, "C-d");
    for (let i = 0; i < 50 && (await tmux.hasSession(name)); i++) await new Promise((r) => setTimeout(r, 100));
    expect(await tmux.hasSession(name)).toBe(false);
    expect(await tmux.hasSession(sibling)).toBe(true);
    await expect(tmux.capturePane(name, 50)).rejects.toThrow();
    await expect(tmux.sendKeys(name, "C-d")).rejects.toThrow();
    expect(await tmux.hasSession(sibling)).toBe(true);
    expect(await tmux.capturePane(sibling, 50)).toContain("sibling-12");
  });
});
