import { homedir } from "node:os";
import { join } from "node:path";
import type { AppConfig } from "./types.js";

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
    projectsPath: env.LIME_PROJECTS ?? join(homedir(), ".claude", "lime-projects.json"),
  };
}
