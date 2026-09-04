#!/usr/bin/env tsx
/**
 * `mojito` — open a Mojito session in the directory the command was run in.
 *
 * The glue half only: git, the env file, fetch and the browser. Every rule lives in
 * src/cli/, which is why this file has no branch worth testing and that directory has
 * tests for all of them.
 */
import { execFileSync, spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import { runMojitoCli, type CliFetch } from "../src/cli/run";
import type { GitPaths } from "../src/cli/resolveProjectForPath";
import { loadProjectMap, listMappedProjects } from "../src/server/projects";
import { resolveProjectsPath } from "../src/server/config";

// @next/env is CJS bundled via ncc — same destructure server.ts does, for the same reason.
const { loadEnvConfig } = nextEnv;

// This file's own directory, symlinks resolved, so `mojito` works from anywhere on PATH.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The same loader the server uses, so the CLI cannot disagree with it about the token or
// the port. Not `dev`: MOJITO_TOKEN lives in .env.local either way, and asking for the
// production layer keeps the CLI reading what `make prod` reads.
loadEnvConfig(repoRoot, false);

function git(...args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

const real = (path: string | null): string | null => {
  if (!path) return null;
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

function gitPaths(): GitPaths {
  const toplevel = real(git("rev-parse", "--show-toplevel"));
  // A linked worktree's common dir is the *main* checkout's .git, which is what
  // projects.json maps. `--path-format=absolute` needs git >= 2.31; older git answers a
  // path relative to the cwd, so resolve it either way.
  const common = git("rev-parse", "--path-format=absolute", "--git-common-dir") ?? git("rev-parse", "--git-common-dir");
  const gitDir = common ? resolve(process.cwd(), common) : null;
  const mainRepo = gitDir ? real(basename(gitDir) === ".git" ? dirname(gitDir) : gitDir) : null;
  return { toplevel, mainRepo };
}

const code = await runMojitoCli(process.argv.slice(2), {
  envFilePath: join(repoRoot, ".env.local"),
  env: process.env,
  gitPaths,
  projects: () => listMappedProjects(loadProjectMap(resolveProjectsPath())),
  fetch: fetch as unknown as CliFetch,
  openUrl: (url) => {
    const opener = process.platform === "darwin" ? "open" : "xdg-open";
    spawn(opener, [url], { detached: true, stdio: "ignore" }).unref();
  },
  log: (line) => console.log(line),
});
process.exit(code);
