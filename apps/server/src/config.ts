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
// or from the bundled dist/ — both sit one level below apps/server.
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const token = env.MOJITO_TOKEN;
  if (!token) throw new Error("MOJITO_TOKEN is required");
  const linearApiKey = env.LINEAR_API_KEY;
  if (!linearApiKey) throw new Error("LINEAR_API_KEY is required");
  const home = env.HOME ?? homedir();
  return {
    port: Number(env.MOJITO_PORT ?? 3100),
    host: env.MOJITO_HOST || "0.0.0.0",
    token,
    linearApiKey,
    stateDir: env.MOJITO_STATE_DIR ?? join(home, ".local", "state", "mojito2"),
    repoRoot: REPO_ROOT.replace(/\/$/, ""),
    projectsJsonPath: env.MOJITO_PROJECTS ?? join(home, ".config", "mojito", "projects.json"),
    home,
  };
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
