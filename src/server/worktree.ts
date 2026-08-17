import { execFile, execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { statusSlug } from "./sessionKey.js";
import { spawnEnv } from "./childEnv.js";

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

export function parseWorktrees(porcelain: string): { path: string; branch: string }[] {
  const out: { path: string; branch: string }[] = [];
  let path = "";
  let branch = "";
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) path = line.slice("worktree ".length).trim();
    else if (line.startsWith("branch ")) branch = line.slice("branch ".length).replace("refs/heads/", "").trim();
    else if (line.trim() === "" && path) {
      out.push({ path, branch });
      path = "";
      branch = "";
    }
  }
  if (path) out.push({ path, branch });
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

// The reason a failure is worth showing tends to be near the END of a tool's output — a
// progress bar or a run of install noise leads up to it — so this keeps the tail, not the
// head. (A head-truncated warning on RIC-203 showed only composer's progress bar, hiding
// whatever actually happened.)
function tail(s: string): string {
  const t = s.trim();
  return t.length > 300 ? `…${t.slice(-300)}` : t;
}

function detail(e: unknown): string {
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

function defaultAsyncGitRun(repo: string): AsyncGitRun {
  return async (args) => (await pexecFile("git", args, { cwd: repo, encoding: "utf8" })).stdout;
}

// Generous but bounded: composer/pnpm installs plus a DB migrate can legitimately take
// several minutes on a cold cache, but a hung script must not wedge a launch forever.
const SCRIPT_TIMEOUT_MS = 10 * 60 * 1000;

// Creates the ticket's worktree at its fixed slugged path, off baseBranch, and — best
// effort — runs scripts/init-worktree.sh inside it if the repo has one. Never
// throws: a failure at either step is reported as a warning, not a blocked launch.
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
  try {
    await run(["worktree", "add", path, "-b", slug, baseBranch]);
  } catch (e) {
    return { cwd: repo, warning: `could not create the worktree: ${detail(e)}` };
  }
  const script = join(repo, "scripts", "init-worktree.sh");
  if (!existsSync(script)) {
    return { cwd: path, warning: "scripts/init-worktree.sh not found — worktree created without setup" };
  }
  try {
    // Never process.env: a setup script's whole job is installing dependencies, and Mojito's
    // own NODE_ENV=production makes that *delete* the worktree's devDependencies (childEnv.ts).
    await pexecFile(script, [], { cwd: path, encoding: "utf8", timeout: scriptTimeoutMs, env: spawnEnv() });
  } catch (e) {
    return { cwd: path, warning: `scripts/init-worktree.sh failed: ${detail(e)}` };
  }
  return { cwd: path };
}
