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

// tmux resolves a bare `-t name` by exact match first, then as a *prefix*, then as a glob —
// so once `mj-RIC-49` is gone, `-t mj-RIC-49` quietly lands on a live `mj-RIC-49x`: keys
// would reach the wrong claude, a reconnecting terminal would attach to the wrong
// session, and a stale row would look alive. `=` asks for the exact name only. A session
// target (has-session, attach-session) is `=name`; a pane target (send-keys, capture-pane,
// set-option) needs the trailing colon to say "that session's active pane" — given a bare
// `=name`, tmux answers "no such session".
export const sessionTarget = (name: string) => `=${name}`;
export const paneTarget = (name: string) => `=${name}:`;

export function tmuxAvailable(): boolean {
  try {
    execFileSync("tmux", ["-V"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// What tmux prints when the session is really not there: the name is unknown to a running
// server, or there is no server at all (`no server running` when the socket refuses,
// `error connecting … (No such file or directory)` when it was never created).
const GONE = /can't find session|no server running|error connecting to .*\(No such file or directory\)/;

/** tmux's failure says the session does not exist, as opposed to tmux failing to answer. */
export function isSessionGone(err: unknown): boolean {
  return GONE.test(String((err as { stderr?: unknown }).stderr ?? ""));
}

/**
 * Whether the session exists. Answers false only when tmux says it does not; any other failure
 * (tmux missing, timed out, a socket it cannot open) rejects, because "could not ask" is not
 * "gone" — taken as gone, a transient hiccup during a terminal attach marked a live session ended.
 */
export async function hasSession(name: string): Promise<boolean> {
  try {
    await pexec("tmux", ["has-session", "-t", sessionTarget(name)]);
    return true;
  } catch (err) {
    if (isSessionGone(err)) return false;
    throw err;
  }
}

// tmux's status line is redundant in Mojito: the ticket, its status and the
// session state are already in the app's own header. On a phone with the
// keyboard open the visible band is only ~13 rows, and that one row is the
// difference between claude's TUI having room for its input line or dropping it.
// Session-scoped, so it never touches the user's own tmux sessions. set-option's `-t` is a
// pane target, so it takes the colon form (`=name` alone is "no such session" there).
const statusOffFor = (name: string) => ["set-option", "-t", paneTarget(name), "status", "off"];

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
  await pexec("tmux", ["send-keys", "-t", paneTarget(name), keys]);
}

export async function listSessions(prefix: string): Promise<string[]> {
  try {
    const { stdout } = await pexec("tmux", ["list-sessions", "-F", "#{session_name}"]);
    return stdout.split("\n").map((s) => s.trim()).filter((s) => s.startsWith(prefix));
  } catch {
    return [];
  }
}

export interface LivePane {
  /** What the program in it last set with an OSC title — claude's is `✳ <session name>`. */
  title: string;
  /** The pane's process, for its systemd scope (`sessions/oom.ts`); null when tmux gave none. */
  pid: number | null;
}

/**
 * The first pane of each session whose name starts with `prefix`, in one tmux call: the live
 * sessions, as far as tmux knows. No tmux server is an empty map (nothing is alive); any other
 * failure rejects — "could not ask" is not "gone".
 */
export async function livePanes(prefix: string): Promise<Map<string, LivePane>> {
  let stdout: string;
  try {
    ({ stdout } = await pexec("tmux", ["list-panes", "-a", "-F", "#{session_name}\t#{pane_pid}\t#{pane_title}"]));
  } catch (err) {
    if (isSessionGone(err)) return new Map();
    throw err;
  }
  const panes = new Map<string, LivePane>();
  for (const line of stdout.split("\n")) {
    const [name = "", pid = "", ...title] = line.split("\t");
    if (!name.startsWith(prefix) || panes.has(name) || title.length === 0) continue;
    const n = Number(pid);
    panes.set(name, { title: title.join("\t"), pid: Number.isInteger(n) && n > 0 ? n : null });
  }
  return panes;
}

// `-e` keeps the SGR escape sequences, so the scrollback the browser terminal
// replays on attach (ptyGateway) comes back in colour instead of flat text.
export async function capturePane(name: string, lines: number): Promise<string> {
  const { stdout } = await pexec("tmux", ["capture-pane", "-t", paneTarget(name), "-p", "-e", "-S", `-${lines}`]);
  return stdout;
}
