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

  afterEach(async () => {
    if (name) await pexec("tmux", ["kill-session", "-t", name]).catch(() => {});
    name = "";
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
});
