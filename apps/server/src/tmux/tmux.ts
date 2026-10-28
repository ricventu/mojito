import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { spawnEnv, tmuxEnvArgs, type EnvLike } from "../env/childEnv";

const pexec = promisify(execFile);

// Every tmux session Mojito creates carries this prefix, so listing and sweeping never
// touch a session the human started themselves.
export const PREFIX = "mj-";

/** Single-quotes `s` for a POSIX shell: an apostrophe closes the quote, is escaped, and reopens it. */
export function q(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/** tmux refused `new-session` because a session by that name already exists. */
export class DuplicateSessionError extends Error {
  constructor(name: string) {
    super(`tmux session already exists: ${name}`);
    this.name = "DuplicateSessionError";
  }
}

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

// tmux's status line is redundant in Mojito: the ticket, its status and the
// session state are already in the app's own header. On a phone with the
// keyboard open the visible band is only ~13 rows, and that one row is the
// difference between claude's TUI having room for its input line or dropping it.
// Session-scoped, so it never touches the user's own tmux sessions.
const STATUS_OFF = ["set-option", "-t", "@NAME@", "status", "off"];
const statusOffFor = (name: string) => STATUS_OFF.map((a) => (a === "@NAME@" ? name : a));

// Mojito's own environment must not reach the shell of anything it spawns (see childEnv.ts
// for what leaks and why it is destructive). Both layers matter: `env` cleans what a tmux
// server *Mojito itself starts* copies into its global environment, and the `-e` overrides
// shadow, session-scoped, whatever a pre-existing server still leaks.
export interface SpawnDeps {
  exec: (file: string, args: string[], opts: { env: NodeJS.ProcessEnv }) => Promise<unknown>;
  globalEnv: () => Promise<Record<string, string>>;
  env: () => EnvLike;
}

const defaultSpawnDeps: SpawnDeps = {
  exec: (file, args, opts) => pexec(file, args, opts),
  globalEnv: () => globalEnvironment(),
  env: () => process.env,
};

// `tmux show-environment -g`, as a map. A variable tmux has been told to unset is printed
// as "-NAME": not set, so it must not come back looking set.
export function parseGlobalEnvironment(stdout: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of stdout.split("\n")) {
    if (!line || line.startsWith("-")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}

// Empty when there is no tmux server yet — nothing running means nothing leaking, and the
// server about to be started inherits the (already sanitized) client environment.
export async function globalEnvironment(): Promise<Record<string, string>> {
  try {
    const { stdout } = await pexec("tmux", ["show-environment", "-g"], { env: spawnEnv() });
    return parseGlobalEnvironment(stdout);
  } catch {
    return {};
  }
}

// Where Mojito runs as a systemd service (the Linux box: `mojito.service`, a user unit), a
// tmux server started from here would land in that service's cgroup, and every restart of
// the service — each "Pull & deploy" — kills the whole cgroup: the server, so every
// session's pty, so every agent in it. A transient scope of its own keeps the server out.
// Only the new-session that happens to start the server needs it, but which one that is
// is a race, so each gets one; a client that finds a server running exits at once and its
// scope with it. INVOCATION_ID is what systemd sets in a service's environment.
export function outsideService(args: string[], env: EnvLike): [string, string[]] {
  if (!env.INVOCATION_ID) return ["tmux", args];
  return ["systemd-run", ["--user", "--scope", "--quiet", "--description=Mojito tmux", "tmux", ...args]];
}

export async function newSession(
  name: string,
  cwd: string,
  command: string,
  deps: Partial<SpawnDeps> = {},
): Promise<void> {
  const d = { ...defaultSpawnDeps, ...deps };
  const [file, args] = outsideService([
    "new-session", "-d", "-s", name, ...tmuxEnvArgs(await d.globalEnv()), "-c", cwd, command,
    ";",
    ...statusOffFor(name),
  ], d.env());
  try {
    await d.exec(file, args, { env: spawnEnv(d.env()) });
  } catch (err) {
    // Matched on the stderr text tmux prints; the exec error carries it as `.stderr`.
    const stderr = String((err as { stderr?: unknown }).stderr ?? "");
    if (/duplicate session/.test(stderr)) throw new DuplicateSessionError(name);
    throw err;
  }
}

export async function sendKeys(name: string, keys: string): Promise<void> {
  await pexec("tmux", ["send-keys", "-t", name, keys]);
}

export interface CloseDeps {
  hasSession: (name: string) => Promise<boolean>;
  sendKeys: (name: string, keys: string) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

/**
 * Ask the claude process in a tmux session to exit, and report whether it did.
 *
 * Sends Ctrl+C (to interrupt any in-flight task) and then Ctrl+D, claude's
 * clean-exit signal — and keeps re-sending Ctrl+D while it waits, because claude
 * answers the first one with "Press Ctrl-D again to exit" and stays up until the
 * second arrives. Sending EOF once and then only watching is what left claude
 * running until the wait was up.
 *
 * There is no force path. When claude exits, its tmux session ends on its own and
 * this returns `{ closed: true }`; a session claude will not leave is reported as
 * `{ closed: false }` and left exactly as it was — tmux, registration and card —
 * for the human to deal with. Killing the session out from under a live claude
 * loses whatever it had not written out yet, which is the one thing a "dismiss"
 * must never do.
 */
export async function closeSession(
  name: string,
  deps: Partial<CloseDeps> = {},
  timeoutMs = 10000,
  pollMs = 250,
): Promise<{ closed: boolean }> {
  const d: CloseDeps = {
    hasSession,
    sendKeys,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
    ...deps,
  };
  if (!(await d.hasSession(name))) return { closed: true };
  // Best-effort signals: the pane can disappear between keystrokes (C-c alone may
  // end the process), which makes a follow-up send-keys throw "can't find pane".
  // Swallow that — the poll below is the source of truth for whether it closed.
  await d.sendKeys(name, "C-c").catch(() => {});
  await d.sendKeys(name, "C-d").catch(() => {});
  const start = d.now();
  while (await d.hasSession(name)) {
    if (d.now() - start >= timeoutMs) return { closed: false };
    await d.sleep(pollMs);
    // The confirmation press. Harmless where one Ctrl-D was already enough: the
    // session is gone by now and send-keys just fails into the catch.
    await d.sendKeys(name, "C-d").catch(() => {});
  }
  return { closed: true };
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
