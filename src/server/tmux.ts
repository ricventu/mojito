import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);

export function tmuxAvailable(): boolean {
  try {
    execFileSync("tmux", ["-V"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export async function hasSession(name: string): Promise<boolean> {
  try {
    await pexec("tmux", ["has-session", "-t", name]);
    return true;
  } catch {
    return false;
  }
}

export async function newSession(name: string, cwd: string, command: string): Promise<void> {
  await pexec("tmux", ["new-session", "-d", "-s", name, "-c", cwd, command]);
}

export async function pipePane(name: string, logfile: string): Promise<void> {
  await pexec("tmux", ["pipe-pane", "-t", name, "-o", `cat >> '${logfile.replace(/'/g, "'\\''")}'`]);
}

export async function killSession(name: string): Promise<void> {
  try {
    await pexec("tmux", ["kill-session", "-t", name]);
  } catch {
    /* already gone */
  }
}

export async function sendKeys(name: string, keys: string): Promise<void> {
  await pexec("tmux", ["send-keys", "-t", name, keys]);
}

export interface CloseDeps {
  hasSession: (name: string) => Promise<boolean>;
  sendKeys: (name: string, keys: string) => Promise<void>;
  killSession: (name: string) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

/**
 * Gracefully shut down the claude process in a tmux session so it flushes its
 * state, rather than tearing the session down with SIGHUP. Sends Ctrl+C (to
 * interrupt any in-flight task) followed by Ctrl+D (EOF), which is claude's
 * clean-exit signal; when claude exits the session auto-closes. Falls back to
 * kill-session only if the process is still alive after `timeoutMs`.
 */
export async function closeSession(
  name: string,
  deps: Partial<CloseDeps> = {},
  timeoutMs = 10000,
  pollMs = 250,
): Promise<{ closed: boolean; forced: boolean }> {
  const d: CloseDeps = {
    hasSession,
    sendKeys,
    killSession,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
    ...deps,
  };
  if (!(await d.hasSession(name))) return { closed: true, forced: false };
  // Best-effort signals: the pane can disappear between keystrokes (C-c alone may
  // end the process), which makes a follow-up send-keys throw "can't find pane".
  // Swallow that — the poll below is the source of truth for whether it closed.
  await d.sendKeys(name, "C-c").catch(() => {});
  await d.sendKeys(name, "C-d").catch(() => {});
  const start = d.now();
  while (await d.hasSession(name)) {
    if (d.now() - start >= timeoutMs) {
      await d.killSession(name);
      return { closed: true, forced: true };
    }
    await d.sleep(pollMs);
  }
  return { closed: true, forced: false };
}

export async function listSessions(prefix: string): Promise<string[]> {
  try {
    const { stdout } = await pexec("tmux", ["list-sessions", "-F", "#{session_name}"]);
    return stdout.split("\n").map((s) => s.trim()).filter((s) => s.startsWith(prefix));
  } catch {
    return [];
  }
}

export async function capturePane(name: string, lines: number): Promise<string> {
  const { stdout } = await pexec("tmux", ["capture-pane", "-t", name, "-p", "-S", `-${lines}`]);
  return stdout;
}
