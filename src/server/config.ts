import { homedir } from "node:os";
import { join } from "node:path";
import type { AppConfig } from "./types";

/**
 * Where Mojito's own configuration files live — `stage-defaults.json` and, since
 * RIC-306, `filter-favorites.json`.
 *
 * One definition for the two readers rather than the same `MOJITO_CONFIG_DIR ??
 * XDG_CONFIG_HOME` chain written twice. Note it is deliberately *not* what
 * resolveProjectsPath below answers with: that one has always looked in a bare
 * `~/.config/mojito`, and teaching it XDG would move an existing user's projects.json
 * out from under them.
 */
export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.MOJITO_CONFIG_DIR
    ?? join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "mojito");
}

/**
 * Resolve the projects map path, in precedence order:
 * 1. `MOJITO_PROJECTS` env var
 * 2. `~/.config/mojito/projects.json` (default location)
 */
export function resolveProjectsPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.MOJITO_PROJECTS) return env.MOJITO_PROJECTS;
  return join(homedir(), ".config", "mojito", "projects.json");
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
