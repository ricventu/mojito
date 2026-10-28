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

  it("refuses to create a second session under a name that is taken", async () => {
    fresh();
    await tmux.newSession(name, tmpdir(), "sleep 30");
    await expect(tmux.newSession(name, tmpdir(), "sleep 30")).rejects.toBeInstanceOf(tmux.DuplicateSessionError);
  });

  it("never force-kills: a process that ignores Ctrl-C and Ctrl-D keeps its session", async () => {
    // The one thing a dismiss must not do is tear tmux down under a live claude —
    // whatever it had not written out yet goes with it. Report, and leave it alone.
    // (A bare `read` would not do as the stubborn process: the pty turns Ctrl-D into EOF
    // and `read` returns, so the loop is what makes it ignore both.)
    fresh();
    await tmux.newSession(name, tmpdir(), `sh -c 'trap "" INT; while :; do sleep 1; done'`);
    expect(await tmux.hasSession(name)).toBe(true);

    expect(await tmux.closeSession(name, {}, 1500, 100)).toEqual({ closed: false });
    expect(await tmux.hasSession(name)).toBe(true);
  });

  it("keeps sending Ctrl-D to a process that wants a second one", async () => {
    // claude ignores Ctrl-C as an exit and answers the first Ctrl-D with "Press
    // Ctrl-D again to exit". A shell that traps SIGINT and reads twice behaves the
    // same way, and against a one-shot EOF it survived the whole wait.
    fresh();
    await tmux.newSession(name, tmpdir(), `sh -c 'trap "" INT; read a; read b'`);
    expect(await tmux.closeSession(name, {}, 8000, 100)).toEqual({ closed: true });
    expect(await tmux.hasSession(name)).toBe(false);
  });

  it("closeSession lets a process that exits on EOF take its session down", async () => {
    fresh();
    await tmux.newSession(name, tmpdir(), "cat");
    expect(await tmux.hasSession(name)).toBe(true);
    expect(await tmux.closeSession(name, {}, 8000, 100)).toEqual({ closed: true });
    expect(await tmux.hasSession(name)).toBe(false);
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

    expect(await tmux.closeSession(name, {}, 8000, 100)).toEqual({ closed: true });
    expect(await tmux.hasSession(name)).toBe(false);
    // closeSession keeps sending Ctrl-D after the first one; a prefix target would have
    // delivered those to the sibling's `cat` and ended it.
    expect(await tmux.hasSession(sibling)).toBe(true);
    await expect(tmux.capturePane(name, 50)).rejects.toThrow();
    await expect(tmux.sendKeys(name, "C-d")).rejects.toThrow();
    expect(await tmux.hasSession(sibling)).toBe(true);
    expect(await tmux.capturePane(sibling, 50)).toContain("sibling-12");
  });
});
