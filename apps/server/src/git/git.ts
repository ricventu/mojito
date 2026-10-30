import { execFile } from "node:child_process";
import { spawnEnv } from "../env/childEnv";

/** Runs git in `cwd` and answers its stdout; a non-zero exit rejects with a `GitError`. */
export type GitRun = (args: string[], cwd: string) => Promise<string>;

/** A git command that failed: `output` is its stdout and stderr together, where git splits its messages. */
export class GitError extends Error {
  constructor(
    readonly args: string[],
    readonly output: string,
  ) {
    super(`git ${args[0]} failed: ${output.trim() || "no output"}`);
    this.name = "GitError";
  }
}

/**
 * git with no shell, in the environment every child gets, plus `LC_ALL=C` (the messages sync.ts
 * reads must be English whatever the locale) and `GIT_TERMINAL_PROMPT=0` (a missing credential
 * fails at once instead of waiting on a prompt nobody sees until the timeout). 120 s covers a
 * slow fetch or push; the large buffer keeps a long output from failing a command that worked.
 */
export const runGit: GitRun = (args, cwd) =>
  new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd,
        timeout: 120_000,
        maxBuffer: 64 * 1024 * 1024,
        encoding: "utf8",
        env: { ...spawnEnv(), LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" },
      },
      (err, stdout, stderr) => {
        if (err) reject(new GitError(args, [stdout, stderr || err.message].filter(Boolean).join("\n")));
        else resolve(stdout);
      },
    );
  });
