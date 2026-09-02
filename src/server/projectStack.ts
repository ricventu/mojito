import { existsSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { listMappedProjects, loadProjectMap, type ProjectMap } from "./projects";
import { statusSlug, stackSessionName } from "./sessionKey";
import { listAllPanes as tmuxListAllPanes, startStackSession, stopStackSession, type PaneInfo } from "./tmux";
import { ffPull, FfPullError, type FfPullResult, type GitRun } from "./ffPull";
import { gitPush, GitPushError, type GitPushResult } from "./gitPush";
import type { StackRow, StackStatus } from "@/lib/stacks";

const pexec = promisify(execFile);

export type { PaneInfo } from "./tmux";

export interface StackDeps {
  projectsPath: string;
  selfPath: string; // the server's own repo root (process.cwd()); its row is not pullable
  loadMap?: (path: string) => ProjectMap;
  isExecutable?: (p: string) => boolean;
  exists?: (p: string) => boolean;
  listPanes?: () => Promise<PaneInfo[]>;
  startSession?: (name: string, cwd: string, command: string) => Promise<void>;
  stopSession?: (name: string) => Promise<void>;
  pull?: (cwd: string) => Promise<FfPullResult>;
  push?: (cwd: string) => Promise<GitPushResult>;
}

export interface StackTarget {
  project: string;
  path: string;
  hasStack: boolean;
  pullable: boolean;
  self: boolean;
}

// `scripts/init-worktree.sh`, tested for existence rather than for the +x bit: this is
// the same check createTicketWorktree makes before it runs the script, so "the repo has
// one" means the same thing in the toolbar as it does at launch time (RIC-253).
function worktreeScriptPath(root: string): string {
  return join(root, "scripts", "init-worktree.sh");
}

function defaultIsExecutable(p: string): boolean {
  try {
    const s = statSync(p);
    return s.isFile() && (s.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

// A pane belongs to the running stack when its cwd sits under the project root.
function isUnder(root: string, cwd: string): boolean {
  if (!cwd) return false;
  const r = resolve(root);
  const c = resolve(cwd);
  return c === r || c.startsWith(r + sep);
}

// Panes launched by Mojito itself (the `stack-<slug>` launcher and `mojito-*`
// ticket sessions) run inside project trees too, so exclude them when looking for
// the stack's own detached child session.
function isMojitoOwnSession(name: string): boolean {
  return name.startsWith("stack-") || name.startsWith("mojito-");
}

// Sessions that hold the actually-running stack, discovered by path: any session
// (other than Mojito's own) with a pane whose cwd is inside the project root.
function childSessions(root: string, panes: PaneInfo[]): Set<string> {
  return new Set(
    panes
      .filter((p) => !isMojitoOwnSession(p.session) && isUnder(root, p.cwd))
      .map((p) => p.session),
  );
}

function deriveStatus(slug: string, root: string, panes: PaneInfo[]): StackStatus {
  // A child session is discovered only via a LIVE pane under the project root
  // (dead panes report no cwd), so its presence means the stack is up. A dead
  // sibling pane — e.g. one dev server that exited while the rest keep running —
  // does not make a working stack "crashed".
  if (childSessions(root, panes).size > 0) return "running";
  // No live stack session: fall back to the launcher pane (booting or failed).
  const launcher = panes.filter((p) => p.session === stackSessionName(slug));
  if (launcher.length === 0) return "stopped";
  if (launcher.some((p) => !p.dead)) return "running"; // start.sh still running
  // All launcher panes dead: non-zero exit means start.sh itself failed.
  return launcher.some((p) => p.deadStatus && p.deadStatus !== "0") ? "crashed" : "stopped";
}

export function resolveStack(slug: string, deps: StackDeps): StackTarget | null {
  const loadMap = deps.loadMap ?? loadProjectMap;
  const isExecutable = deps.isExecutable ?? defaultIsExecutable;
  const match = listMappedProjects(loadMap(deps.projectsPath)).find((p) => statusSlug(p.name) === slug);
  if (!match) return null;
  return {
    project: match.name,
    path: match.path,
    hasStack: isExecutable(join(match.path, "scripts", "start.sh")),
    pullable: resolve(match.path) !== resolve(deps.selfPath),
    self: resolve(match.path) === resolve(deps.selfPath),
  };
}

export async function listStacks(deps: StackDeps): Promise<StackRow[]> {
  const loadMap = deps.loadMap ?? loadProjectMap;
  const isExecutable = deps.isExecutable ?? defaultIsExecutable;
  const listPanes = deps.listPanes ?? tmuxListAllPanes;
  const projects = listMappedProjects(loadMap(deps.projectsPath));
  const panes = await listPanes();
  const exists = deps.exists ?? existsSync;
  return projects.map(({ name, path }): StackRow => {
    const slug = statusSlug(name);
    const hasStack = isExecutable(join(path, "scripts", "start.sh"));
    return {
      project: name,
      slug,
      path,
      hasStack,
      status: hasStack ? deriveStatus(slug, path, panes) : null,
      pullable: resolve(path) !== resolve(deps.selfPath),
      self: resolve(path) === resolve(deps.selfPath),
      hasWorktreeScript: exists(worktreeScriptPath(path)),
    };
  });
}

export type StackActionResult =
  | { ok: true; status: StackStatus }
  | { ok: false; error: string; code: number };

export async function startStack(slug: string, deps: StackDeps): Promise<StackActionResult> {
  const target = resolveStack(slug, deps);
  if (!target || !target.hasStack) return { ok: false, error: "no stack", code: 404 };
  const listPanes = deps.listPanes ?? tmuxListAllPanes;
  const startSession = deps.startSession ?? startStackSession;
  const stopSession = deps.stopSession ?? stopStackSession;
  const name = stackSessionName(slug);
  const panes = await listPanes();
  if (deriveStatus(slug, target.path, panes) === "running") {
    return { ok: false, error: "already running", code: 409 };
  }
  // Clear a stale launcher pane (a previous failed/exited start.sh) so the new
  // session name is free.
  if (panes.some((p) => p.session === name)) await stopSession(name);
  await startSession(name, target.path, "bash -lc 'scripts/start.sh'");
  return { ok: true, status: "running" };
}

export async function stopStack(slug: string, deps: StackDeps): Promise<StackActionResult> {
  const target = resolveStack(slug, deps);
  if (!target || !target.hasStack) return { ok: false, error: "no stack", code: 404 };
  const listPanes = deps.listPanes ?? tmuxListAllPanes;
  const stopSession = deps.stopSession ?? stopStackSession;
  const name = stackSessionName(slug);
  const panes = await listPanes();
  const children = childSessions(target.path, panes);
  const launcherPresent = panes.some((p) => p.session === name);
  if (children.size === 0 && !launcherPresent) {
    return { ok: false, error: "not running", code: 409 };
  }
  // Stop the real stack session(s) cleanly (reap process groups to free ports),
  // then clear the launcher pane.
  for (const child of children) await stopSession(child);
  if (launcherPresent) await stopSession(name);
  return { ok: true, status: "stopped" };
}

export type StackPullResult =
  | { ok: true; result: FfPullResult }
  | { ok: false; error: string; code: number; detail?: string };

const pullInflight = new Map<string, Promise<FfPullResult>>();
const pushInflight = new Map<string, Promise<GitPushResult>>();

export function _resetStackInflight(): void {
  pullInflight.clear();
  pushInflight.clear();
}

// One in-flight git operation per slug: a second POST while one runs gets its result.
function singleFlight<T>(map: Map<string, Promise<T>>, slug: string, op: () => Promise<T>): Promise<T> {
  const running = map.get(slug);
  if (running) return running;
  const started = (async () => {
    try {
      return await op();
    } finally {
      map.delete(slug);
    }
  })();
  map.set(slug, started);
  return started;
}

export async function pullStack(slug: string, deps: StackDeps): Promise<StackPullResult> {
  const target = resolveStack(slug, deps);
  if (!target || !target.pullable) return { ok: false, error: "not pullable", code: 404 };
  const pull = deps.pull ?? ((cwd: string) => ffPull(cwd));
  try {
    return { ok: true, result: await singleFlight(pullInflight, slug, () => pull(target.path)) };
  } catch (e) {
    if (e instanceof FfPullError) {
      return { ok: false, error: e.kind, code: e.kind === "diverged" ? 409 : 500, detail: e.detail };
    }
    return { ok: false, error: "failed", code: 500, detail: String(e) };
  }
}

export type StackPushResult =
  | { ok: true; result: GitPushResult }
  | { ok: false; error: string; code: number; detail?: string };

/**
 * Push the mapped checkout's current branch. Unlike pull, the Mojito self-row IS
 * pushable: a push fires no **post-merge** hook (the deploy trigger), so the post-merge
 * deploy hazard that makes the self-row unpullable does not apply here. (A `pre-push`
 * hook, if one existed, would still run — it just isn't the hazard in play.)
 */
export async function pushStack(slug: string, deps: StackDeps): Promise<StackPushResult> {
  const target = resolveStack(slug, deps);
  if (!target) return { ok: false, error: "unknown stack", code: 404 };
  const push = deps.push ?? ((cwd: string) => gitPush(cwd));
  try {
    return { ok: true, result: await singleFlight(pushInflight, slug, () => push(target.path)) };
  } catch (e) {
    if (e instanceof GitPushError) {
      return { ok: false, error: e.kind, code: e.kind === "rejected" ? 409 : 500, detail: e.detail };
    }
    return { ok: false, error: "failed", code: 500, detail: String(e) };
  }
}

export async function currentBranch(cwd: string, run: GitRun = (args, c) =>
  pexec("git", args, { cwd: c, timeout: 10_000, encoding: "utf8" })): Promise<string> {
  const { stdout } = await run(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  return stdout.trim();
}
