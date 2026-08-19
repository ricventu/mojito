import { describe, it, expect, afterAll, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
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

  // The browser terminal already shows the ticket and its state in Mojito's own
  // header, so tmux's status line is redundant chrome — and on a phone with the
  // keyboard up it costs the one row the TUI needs for its input line.
  it("creates sessions with tmux's status line off", async () => {
    const name = "mojito-test-status-off";
    await tmux.killSession(name).catch(() => {});
    await tmux.newSession(name, tmpdir(), "sleep 30");
    expect(await tmux.statusOption(name)).toBe("off");
    await tmux.killSession(name);

    await startStackSession(name, process.cwd(), "sleep 30");
    expect(await tmux.statusOption(name)).toBe("off");
    await tmux.killSession(name);
  });

  it("closeSession interrupts the process and lets the session auto-close (no force)", async () => {
    const CLOSE_NAME = "mojito-test-ric-1-close";
    await tmux.newSession(CLOSE_NAME, tmpdir(), "sleep 30");
    expect(await tmux.hasSession(CLOSE_NAME)).toBe(true);
    // C-c interrupts sleep, the session command exits, and tmux tears the session down.
    const res = await tmux.closeSession(CLOSE_NAME, {}, 8000, 100);
    expect(res).toEqual({ closed: true });
    expect(await tmux.hasSession(CLOSE_NAME)).toBe(false);
  });

  it("keeps sending Ctrl-D to a process that wants a second one", async () => {
    // claude ignores Ctrl-C as an exit and answers the first Ctrl-D with "Press
    // Ctrl-D again to exit". A shell that traps SIGINT and reads twice behaves the
    // same way, and against the old one-shot EOF it survived the whole wait.
    const name = "mojito-test-ric-1-two-eof";
    await tmux.killSession(name).catch(() => {});
    await tmux.newSession(name, tmpdir(), `bash -c 'trap "" INT; read -r a; read -r b'`);
    expect(await tmux.hasSession(name)).toBe(true);

    const res = await tmux.closeSession(name, {}, 8000, 100);
    expect(res).toEqual({ closed: true });
    expect(await tmux.hasSession(name)).toBe(false);
  });

  it("never force-kills: a process that ignores both signals keeps its session", async () => {
    // The one thing a dismiss must not do is tear tmux down under a live claude —
    // whatever it had not written out yet goes with it. Report, and leave it alone.
    const name = "mojito-test-ric-1-stubborn";
    await tmux.killSession(name).catch(() => {});
    await tmux.newSession(name, tmpdir(), `bash -c 'trap "" INT; while :; do sleep 1; done'`);

    const res = await tmux.closeSession(name, {}, 600, 100);
    expect(res).toEqual({ closed: false });
    expect(await tmux.hasSession(name)).toBe(true);
    await tmux.killSession(name);
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

  // RIC-207 end to end, against a real tmux server: whatever that server's global
  // environment holds, the pane a Mojito session runs in must not see Mojito's
  // NODE_ENV=production (under which pnpm/npm strip a workspace's devDependencies) or the
  // credentials Mojito loaded from its own .env.
  it("gives a session's pane none of Mojito's own environment", async () => {
    const name = "mojito-test-env-scrub";
    const dump = join(mkdtempSync(join(tmpdir(), "mojito-env-")), "env.txt");
    await tmux.killSession(name).catch(() => {});

    // Next's type augmentation declares NODE_ENV read-only; this test's whole point is
    // starting from the polluted environment `npm start` really gives the server.
    const env = process.env as Record<string, string | undefined>;
    env.NODE_ENV = "production";
    env.LINEAR_API_KEY = "lin_api_should_not_leak";
    try {
      await tmux.newSession(name, tmpdir(), `sh -c 'printf "[%s][%s]" "$NODE_ENV" "$LINEAR_API_KEY" > ${dump}; sleep 5'`);
      await vi.waitFor(() => expect(existsSync(dump)).toBe(true), { timeout: 5000 });
      expect(readFileSync(dump, "utf8")).toBe("[][]");
    } finally {
      delete env.LINEAR_API_KEY;
      delete env.NODE_ENV;
      await tmux.killSession(name);
    }
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
