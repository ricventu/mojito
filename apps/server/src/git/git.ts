import { execFile } from "node:child_process";
import { spawnEnv } from "../env/childEnv";

/** Runs git in `cwd` and answers its stdout; a non-zero exit rejects with a `GitError`. */
export type GitRun = (args: string[], cwd: string) => Promise<string>;

/**
 * A git command that failed: `output` is its stdout and stderr together, where git splits its
 * messages; `exitCode` is the process's, `null` when it was killed (timeout) or never ran.
 */
export class GitError extends Error {
  constructor(
    readonly args: string[],
    readonly output: string,
    readonly exitCode: number | null = null,
  ) {
    super(`git ${args[0]} failed: ${output.trim() || "no output"}`);
    this.name = "GitError";
  }
}

/**
 * A runner for git with no shell, in the environment every child gets, plus `LC_ALL=C` (the
 * messages sync.ts reads must be English whatever the locale) and `GIT_TERMINAL_PROMPT=0` (a
 * missing credential fails at once instead of waiting on a prompt nobody sees until the
 * timeout). The large buffer keeps a long output from failing a command that worked.
 */
export const gitRunner =
  (timeoutMs: number): GitRun =>
  (args, cwd) =>
    new Promise((resolve, reject) => {
      execFile(
        "git",
        args,
        {
          cwd,
          timeout: timeoutMs,
          maxBuffer: 64 * 1024 * 1024,
          encoding: "utf8",
          env: { ...spawnEnv(), LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" },
        },
        (err, stdout, stderr) => {
          if (err) {
            // `code` is the exit status for a non-zero exit, a string such as "ENOENT" when git never ran.
            const exitCode = !err.killed && typeof err.code === "number" ? err.code : null;
            // Killed by the timeout (not the buffer cap, which sets a string code): node's own
            // "Command failed: git log …" says nothing a reader can act on.
            const timedOut = err.killed && typeof err.code !== "string";
            const output = timedOut
              ? `git did not answer within ${timeoutMs / 1000} s`
              : [stdout, stderr || err.message].filter(Boolean).join("\n");
            reject(new GitError(args, output, exitCode));
          }
          else resolve(stdout);
        },
      );
    });

/** Pull and push: 120 s covers a slow fetch or push. */
export const runGit: GitRun = gitRunner(120_000);

/** The reads behind the graph and commit views: a repo that cannot answer in 10 s is not read. */
export const readGit: GitRun = gitRunner(10_000);
