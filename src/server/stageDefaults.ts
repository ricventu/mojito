import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import type { Effort } from "./types.js";
import {
  mergeEffective, resolveModel, resolveEffort, type StageDefaults,
} from "@/lib/stageDefaults";

let cache: StageDefaults | undefined;

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  const dir = env.MOJITO_CONFIG_DIR
    ?? join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "mojito");
  return join(dir, "stage-defaults.json");
}

// Read the override layer. Missing or corrupt file -> {} (built-ins only). Cached in-process;
// the single Next.js process makes a module-level cache safe. Invalidated by writeOverrides
// and by _resetStageDefaultsCache (tests).
export function readOverrides(): StageDefaults {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(readFileSync(configPath(), "utf8"));
    cache = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as StageDefaults)
      : {};
  } catch {
    cache = {};
  }
  return cache;
}

export function readEffective(): StageDefaults {
  return mergeEffective(readOverrides());
}

export function writeOverrides(next: StageDefaults): void {
  const p = configPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(next, null, 2));
  cache = next;
}

export function defaultModelForStatus(status: string): string {
  return resolveModel(status, readOverrides());
}

export function defaultEffortForStatus(status: string): Effort {
  return resolveEffort(status, readOverrides());
}

export function _resetStageDefaultsCache(): void {
  cache = undefined;
}
