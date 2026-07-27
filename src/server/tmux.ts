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

export async function startStackSession(name: string, cwd: string, command: string): Promise<void> {
  // Create the session and set remain-on-exit window-scoped in the SAME invocation,
  // so a pane that dies immediately is retained (status "crashed") instead of vanishing.
  await pexec("tmux", [
    "new-session", "-d", "-s", name, "-c", cwd, command,
    ";",
    "set-option", "-w", "-t", name, "remain-on-exit", "on",
  ]);
}

export async function panesDead(name: string): Promise<string> {
  try {
    const { stdout } = await pexec("tmux", ["list-panes", "-t", name, "-F", "#{pane_dead}"]);
    return stdout;
  } catch {
    return "";
  }
}

export interface PaneInfo {
  session: string;
  dead: boolean;
  deadStatus: string; // exit code of a dead pane ("" while alive)
  cwd: string; // pane_current_path ("" when the pane is dead)
}

// Every pane on the tmux server, across all sessions. Used to detect a stack's
// real liveness: launcher scripts (scripts/start.sh) spawn their own detached
// session and exit, so the launcher pane dies — the running stack lives in a
// child session whose panes sit under the project directory.
export async function listAllPanes(): Promise<PaneInfo[]> {
  try {
    const { stdout } = await pexec("tmux", [
      "list-panes", "-a", "-F",
      "#{session_name}\t#{pane_dead}\t#{pane_dead_status}\t#{pane_current_path}",
    ]);
    return stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [session, dead, deadStatus, cwd = ""] = line.split("\t");
        return { session, dead: dead === "1", deadStatus, cwd };
      });
  } catch {
    return [];
  }
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

// Stop a stack's session cleanly. `tmux kill-session` alone does not reap each
// pane's descendant tree (dev servers -> concurrently -> php -S / next), leaving
// ports held by orphans. Every pane's children share its process group, so
// signal each group (SIGTERM, then SIGKILL for stragglers) before killing the
// session. This mirrors the stacks' own `start.sh --stop` but stays generic —
// Mojito never needs to know the child session's name or `--stop` flag.
export async function stopStackSession(name: string): Promise<void> {
  const script = `
    for sig in TERM KILL; do
      for pid in $(tmux list-panes -s -t "$1" -F '#{pane_pid}' 2>/dev/null); do
        pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')" || pgid=
        [ -n "$pgid" ] && kill -"$sig" -- "-$pgid" 2>/dev/null || true
      done
      [ "$sig" = TERM ] && sleep 2 || true
    done
    tmux kill-session -t "$1" 2>/dev/null || true
  `;
  try {
    await pexec("bash", ["-c", script, "bash", name]);
  } catch {
    /* best-effort: session may already be gone */
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

// `-e` keeps the SGR escape sequences, so the scrollback the browser terminal
// replays on attach (ptyGateway) comes back in colour instead of flat text.
export async function capturePane(name: string, lines: number): Promise<string> {
  const { stdout } = await pexec("tmux", ["capture-pane", "-t", name, "-p", "-e", "-S", `-${lines}`]);
  return stdout;
}
