import { execFileSync } from "node:child_process";

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
