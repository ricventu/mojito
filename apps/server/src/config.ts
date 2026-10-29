import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { registerEnvFileKeys } from "./env/childEnv";

export interface ServerConfig {
  port: number;
  host: string;
  token: string;
  linearApiKey: string;
  stateDir: string;
  repoRoot: string;
  projectsJsonPath: string;
  home: string;
}

// The repository root, two levels above apps/server. Resolved from this module's own
// location rather than the cwd, so it is the same whether the server runs from src/ (tsx)
// or from the bundled dist/ — both sit one level below apps/server. Exported on its own
// because it is needed before `loadConfig` can run: `.env.local`, which usually carries
// the token `loadConfig` requires, is found there.
export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url)).replace(/\/$/, "");

/**
 * Port and host are v2's own (`MOJITO2_PORT`, default 3100; `MOJITO2_HOST`, default 127.0.0.1 —
 * loopback, like the old app: the Linux box has a public address, and the phone reaches v2
 * through Tailscale Serve, never directly).
 * `MOJITO_PORT`/`MOJITO_HOST` are deliberately ignored: they belong to the old app, live in the
 * same shared `.env.local` (8700 on 127.0.0.1 on the Linux box), and read here they made v2
 * collide with it. The token and the Linear key stay shared — one Linear workspace, one login.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const token = env.MOJITO_TOKEN;
  if (!token) throw new Error("MOJITO_TOKEN is required");
  const linearApiKey = env.LINEAR_API_KEY;
  if (!linearApiKey) throw new Error("LINEAR_API_KEY is required");
  const home = env.HOME ?? homedir();
  return {
    port: Number(env.MOJITO2_PORT || 3100),
    host: env.MOJITO2_HOST || "127.0.0.1",
    token,
    linearApiKey,
    stateDir: env.MOJITO_STATE_DIR ?? join(home, ".local", "state", "mojito2"),
    repoRoot: REPO_ROOT,
    projectsJsonPath: env.MOJITO_PROJECTS ?? join(home, ".config", "mojito", "projects.json"),
    home,
  };
}

/**
 * The origin Mojito's own children (the hook curls) reach the server at. A wildcard bind
 * (`0.0.0.0`, `::`) listens on loopback too, so that is used; any other host is the only
 * address the server answers on, so it is used as configured — a hard-coded 127.0.0.1 never
 * reached a server bound to, say, a Tailscale address.
 */
export function selfOrigin(cfg: Pick<ServerConfig, "host" | "port">): string {
  const host = cfg.host === "0.0.0.0" || cfg.host === "::" || cfg.host === "" ? "127.0.0.1" : cfg.host;
  return `http://${host.includes(":") ? `[${host}]` : host}:${cfg.port}`;
}

/**
 * Loads a dotenv file into `process.env`, the way the old app's loader did: a key already
 * set in the environment wins over the file. Whatever the file adds is registered with
 * `registerEnvFileKeys`, so a credential added to `.env.local` later is scrubbed from every
 * child's environment without anyone updating a list. A missing file is not an error.
 */
export function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const parsed = parseEnv(readFileSync(path, "utf8"));
  registerEnvFileKeys(() => {
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
  });
}
