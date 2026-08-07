import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AppConfig } from "./types.js";

/**
 * Resolve the projects map path, in precedence order:
 * 1. `MOJITO_PROJECTS` env var
 * 2. `LIME_PROJECTS` env var (legacy, honored for one release)
 * 3. `~/.config/mojito/projects.json`, if it exists
 * 4. `~/.claude/lime-projects.json` (legacy lime location, final fallback)
 */
export function resolveProjectsPath(
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = existsSync,
): string {
  if (env.MOJITO_PROJECTS) return env.MOJITO_PROJECTS;
  if (env.LIME_PROJECTS) return env.LIME_PROJECTS; // legacy env, honored for one release
  const modern = join(homedir(), ".config", "mojito", "projects.json");
  if (exists(modern)) return modern;
  return join(homedir(), ".claude", "lime-projects.json"); // legacy lime location
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const token = env.MOJITO_TOKEN;
  if (!token) throw new Error("MOJITO_TOKEN is required");
  const linearApiKey = env.LINEAR_API_KEY;
  if (!linearApiKey) throw new Error("LINEAR_API_KEY is required");
  return {
    port: Number(env.MOJITO_PORT ?? 4711),
    token,
    linearApiKey,
    stateDir: env.MOJITO_STATE_DIR ?? join(homedir(), ".mojito-state"),
    projectsPath: resolveProjectsPath(env),
  };
}
