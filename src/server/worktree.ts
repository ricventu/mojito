import { execFile, execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { statusSlug } from "./sessionKey";
import { spawnEnv } from "./childEnv";

const pexecFile = promisify(execFile);

// Kept short so branch names and directory names stay readable — long ticket titles get
// truncated, not the ticket id half.
const SLUG_TITLE_MAX = 40;

// The worktree/branch name Mojito creates for a ticket: <ticket>-<kebab-title>, or the
// bare ticket id when the title has nothing sluggable (statusSlug() strips to "").
export function worktreeSlug(ticket: string, title: string): string {
  const titleSlug = statusSlug(title).slice(0, SLUG_TITLE_MAX).replace(/-+$/, "");
  return titleSlug ? `${ticket}-${titleSlug}` : ticket;
}

// git resolves symlinks when it reports a worktree's path (e.g. macOS's /var ->
// /private/var), so any comparison against `git worktree list` output has to start from
// the same resolved path or a symlinked repo location would never match its own worktree.
function realRepoPath(repo: string): string {
  try {
    return realpathSync(repo);
  } catch {
    return repo;
  }
}

// Where Mojito creates a ticket's worktree: fixed, inside the repo, never guessed.
function fixedWorktreePath(repo: string, ticket: string, title: string): string {
  return join(realRepoPath(repo), ".claude", "worktrees", worktreeSlug(ticket, title));
}

// One entry of `git worktree list --porcelain`. The three flags are set only when git
// actually reports them, so a plain worktree stays the bare { path, branch } this has
// always been — every existing caller compares that shape.
export interface WorktreeEntry {
  path: string;
  branch: string;
  // No working tree to launch in.
  bare?: boolean;
  // On a commit rather than a branch — usable, but it has no branch name to label it with.
  detached?: boolean;
  // Registered but its directory is gone; git would refuse to work there.
  prunable?: boolean;
}

export function parseWorktrees(porcelain: string): WorktreeEntry[] {
  const out: WorktreeEntry[] = [];
  let entry: WorktreeEntry = { path: "", branch: "" };
  const flush = () => {
    if (entry.path) out.push(entry);
    entry = { path: "", branch: "" };
  };
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) entry.path = line.slice("worktree ".length).trim();
    else if (line.startsWith("branch ")) entry.branch = line.slice("branch ".length).replace("refs/heads/", "").trim();
    // `prunable` and `detached` carry an optional reason after the keyword, `bare` never does.
    else if (line.trim() === "bare") entry.bare = true;
    else if (line === "detached" || line.startsWith("detached ")) entry.detached = true;
    else if (line === "prunable" || line.startsWith("prunable ")) entry.prunable = true;
    else if (line.trim() === "" && entry.path) flush();
  }
  flush();
  return out;
}

export function matchWorktree(worktrees: { path: string; branch: string }[], ticket: string): string | null {
  const needle = ticket.toLowerCase();
  const hit = worktrees.find((w) => w.branch.toLowerCase().includes(needle));
  return hit ? hit.path : null;
}

export function resolveWorktree(
  repoPath: string,
  ticket: string,
  run: (cmd: string, args: string[]) => string = (cmd, args) =>
    execFileSync(cmd, args, { cwd: repoPath, encoding: "utf8" }),
): string | null {
  try {
    return matchWorktree(parseWorktrees(run("git", ["worktree", "list", "--porcelain"])), ticket);
  } catch {
    return null;
  }
}

type GitRun = (args: string[]) => string;

function defaultGitRun(repo: string): GitRun {
  return (args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}

export function listLocalBranches(repo: string, run: GitRun = defaultGitRun(repo)): string[] {
  try {
    return run(["for-each-ref", "--format=%(refname:short)", "refs/heads/"])
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

// The repo's remote-tracking branches, spelled the way `git worktree add` takes them as a
// start point (`origin/main`). Offered alongside the local ones because branching off the
// local `main` is branching off whatever that checkout last pulled, which is routinely
// behind the server.
//
// `origin/HEAD` is dropped: it is a symref onto one of the branches already in the list, so
// keeping it would offer the same branch twice under a name that hides which one it is. It is
// matched on `refname:strip=2` and not on `refname:short`, which shortens
// `refs/remotes/origin/HEAD` all the way down to a bare `origin` — a value that looks like a
// branch name, sorts first, and is the very ref meant to be filtered out.
export function listRemoteBranches(repo: string, run: GitRun = defaultGitRun(repo)): string[] {
  try {
    return run(["for-each-ref", "--format=%(refname:strip=2)", "refs/remotes/"])
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.endsWith("/HEAD"));
  } catch {
    return [];
  }
}

// The ticket's worktree if one already exists — the fixed slugged path Mojito creates,
// or (compatibility with worktrees a session created on its own before this existed) any
// worktree whose branch name carries the ticket id, wherever it lives. Never creates.
export function findExistingTicketWorktree(repo: string, ticket: string, title: string, run: GitRun = defaultGitRun(repo)): string | null {
  let worktrees: { path: string; branch: string }[];
  try {
    worktrees = parseWorktrees(run(["worktree", "list", "--porcelain"]));
  } catch {
    return null;
  }
  const fixed = fixedWorktreePath(repo, ticket, title);
  if (worktrees.some((w) => w.path === fixed)) return fixed;
  return matchWorktree(worktrees, ticket);
}

// The repo's linked worktrees, as a picker can offer them: never the repo itself (that is
// the no-pick fallback, not a choice), never a bare one (no working tree to launch in) and
// never a prunable one (its directory is gone, so git would refuse to work there). Never
// throws — a repo git cannot read simply offers nothing.
export function listPickableWorktrees(repo: string, run: GitRun = defaultGitRun(repo)): WorktreeEntry[] {
  let worktrees: WorktreeEntry[];
  try {
    worktrees = parseWorktrees(run(["worktree", "list", "--porcelain"]));
  } catch {
    return [];
  }
  const self = realRepoPath(repo);
  return worktrees.filter((w) => w.path !== self && !w.bare && !w.prunable);
}

// A client-chosen worktree path, echoed back only when the repo really has a worktree
// there. The value names the directory a session is spawned in, so it is never trusted:
// anything not in listPickableWorktrees — an invented path, or one whose worktree was
// removed between the sheet's fetch and the launch — answers null, and the caller falls
// back to the repo root.
export function resolveWorktreePick(repo: string, path: string, run: GitRun = defaultGitRun(repo)): string | null {
  if (!path) return null;
  return listPickableWorktrees(repo, run).some((w) => w.path === path) ? path : null;
}

// The reason a failure is worth showing tends to be near the END of a tool's output — a
// progress bar or a run of install noise leads up to it — so this keeps the tail, not the
// head. (A head-truncated warning on RIC-203 showed only composer's progress bar, hiding
// whatever actually happened.)
function tail(s: string): string {
  const t = s.trim();
  return t.length > 300 ? `…${t.slice(-300)}` : t;
}

// The end of a failed git/script run, for a warning a human reads: stderr when the failure
// carries one, the error message otherwise. Exported because the fetch action reports its
// own failures the same way (fetchTicketRemotes.ts) and truncation logic copied twice drifts.
export function gitFailureDetail(e: unknown): string {
  if (e && typeof e === "object" && "stderr" in e && typeof (e as { stderr: unknown }).stderr === "string") {
    return tail((e as { stderr: string }).stderr);
  }
  return tail(e instanceof Error ? e.message : String(e));
}

export interface WorktreeResult {
  cwd: string;
  // Set on anything that didn't block the launch but the human should know about: the
  // worktree got created without its setup script (missing or failing), or creation
  // itself failed and the launch fell back to the repo root.
  warning?: string;
}

type AsyncGitRun = (args: string[]) => Promise<string>;

// A `git fetch` crosses the network and a `git worktree add` checks out a whole tree, so
// neither is instant — but neither may wedge a launch (or the Fetch action's request)
// forever either.
const GIT_TIMEOUT_MS = 2 * 60 * 1000;

function defaultAsyncGitRun(repo: string): AsyncGitRun {
  return async (args) => (await pexecFile("git", args, {
    cwd: repo,
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
    // Not spawnEnv(): git wants the real environment here — SSH_AUTH_SOCK and the
    // credential helper's config are how a fetch authenticates at all. GIT_TERMINAL_PROMPT
    // is the one override: there is nothing on this stdin to answer a username prompt with,
    // so a fetch that needs one has to fail now rather than hang until the timeout.
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  })).stdout;
}

/**
 * The remote a base-branch name belongs to, or null when it names a local branch.
 *
 * Split against the repo's actual remotes rather than on the first slash: `feature/foo` is
 * a perfectly ordinary local branch name, and only `git remote` can say whether the leading
 * segment is a remote. Longest match first, so a repo with both `origin` and `origin/mirror`
 * as remote names resolves the more specific one.
 */
export function splitRemoteRef(ref: string, remotes: readonly string[]): { remote: string; branch: string } | null {
  const hit = [...remotes].sort((a, b) => b.length - a.length).find((r) => ref.startsWith(`${r}/`));
  return hit ? { remote: hit, branch: ref.slice(hit.length + 1) } : null;
}

/**
 * Fetches every remote and prunes the tracking refs whose branch is gone, for the launch
 * sheet's Fetch action: the base-branch list is only as fresh as the last fetch, and pruning
 * is what stops it offering a branch that no longer exists on the server.
 *
 * Throws on failure — unlike the targeted fetch inside createTicketWorktree, this one *is*
 * the user's request, so its failure is a message and not a footnote.
 */
export async function fetchAllRemotes(repo: string, run: AsyncGitRun = defaultAsyncGitRun(repo)): Promise<void> {
  await run(["fetch", "--all", "--prune"]);
}

/**
 * Brings the picked base up to date when it is a remote one, so "off origin/main" means what
 * it says instead of "off whatever origin/main looked like at the last fetch".
 *
 * Targeted rather than `fetch --all`: one branch over the network, and nothing at all when
 * the pick is local. Best effort — a fetch that fails (offline, expired credentials) leaves
 * the worktree branching off the ref git already had, with a warning; an unreachable network
 * is not a reason to refuse to start work.
 *
 * `git fetch <remote> <branch>` updates `refs/remotes/<remote>/<branch>` on the way, since
 * the branch is covered by the remote's configured refspec (git ≥ 1.8.4), so the ref
 * `worktree add` reads next is the one just fetched.
 */
async function fetchBaseBranch(baseBranch: string, run: AsyncGitRun): Promise<string | null> {
  let remotes: string[];
  try {
    remotes = (await run(["remote"])).split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    // No readable remotes — treat the base as local, exactly as before this existed.
    return null;
  }
  const hit = splitRemoteRef(baseBranch, remotes);
  if (!hit) return null;
  try {
    await run(["fetch", hit.remote, hit.branch]);
    return null;
  } catch (e) {
    return `could not fetch ${baseBranch} — branching off the last fetched state: ${gitFailureDetail(e)}`;
  }
}

// One warning field, and a creation can now collect two of them (a stale-base fetch and a
// failing setup script are independent). Absent rather than empty when there is nothing to
// say: callers echo the warning as the session's first terminal line.
function worktreeResult(cwd: string, warnings: readonly string[]): WorktreeResult {
  return warnings.length ? { cwd, warning: warnings.join(" · ") } : { cwd };
}

// Generous but bounded: composer/pnpm installs plus a DB migrate can legitimately take
// several minutes on a cold cache, but a hung script must not wedge a launch forever.
const SCRIPT_TIMEOUT_MS = 10 * 60 * 1000;

// Creates the ticket's worktree at its fixed slugged path, off baseBranch — fetching that
// base first when it is a remote-tracking one — and, best effort, runs
// scripts/init-worktree.sh inside it if the repo has one. Never throws: a failure at any of
// the three steps is reported as a warning, not a blocked launch.
//
// Both git and the setup script run through async execFile, never execFileSync: the setup
// script (composer/pnpm install, a DB migrate, ...) can run for minutes, and a sync call
// would block Node's single-threaded event loop for the whole duration — freezing the
// entire server, including /api/health, which trips prod-supervisor.mjs's watchdog into
// killing and restarting the server mid-request (RIC-203: that's what "creating a worktree
// gave an error" actually was — the request's own connection got reset by the restart).
export async function createTicketWorktree(
  repo: string,
  ticket: string,
  title: string,
  baseBranch: string,
  run: AsyncGitRun = defaultAsyncGitRun(repo),
  scriptTimeoutMs: number = SCRIPT_TIMEOUT_MS,
): Promise<WorktreeResult> {
  const slug = worktreeSlug(ticket, title);
  const path = fixedWorktreePath(repo, ticket, title);
  const warnings: string[] = [];
  // Before the add, not after: the point is for `worktree add` to read the ref this refreshed.
  const stale = await fetchBaseBranch(baseBranch, run);
  if (stale) warnings.push(stale);
  try {
    await run(["worktree", "add", path, "-b", slug, baseBranch]);
  } catch (e) {
    // The fetch warning rides along: a failed fetch is often the reason the base does not
    // resolve at all (a branch that only ever existed on the remote).
    return worktreeResult(repo, [...warnings, `could not create the worktree: ${gitFailureDetail(e)}`]);
  }
  const script = join(repo, "scripts", "init-worktree.sh");
  if (!existsSync(script)) {
    return worktreeResult(path, [...warnings, "scripts/init-worktree.sh not found — worktree created without setup"]);
  }
  try {
    // Never process.env: a setup script's whole job is installing dependencies, and Mojito's
    // own NODE_ENV=production makes that *delete* the worktree's devDependencies (childEnv.ts).
    await pexecFile(script, [], { cwd: path, encoding: "utf8", timeout: scriptTimeoutMs, env: spawnEnv() });
  } catch (e) {
    return worktreeResult(path, [...warnings, `scripts/init-worktree.sh failed: ${gitFailureDetail(e)}`]);
  }
  return worktreeResult(path, warnings);
}
