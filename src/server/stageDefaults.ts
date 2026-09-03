import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { configDir } from "./config";
import type { Effort } from "./types";
import {
  mergeEffective, resolveModel, resolveEffort, sanitizeOverrides, type StageDefaults,
} from "@/lib/stageDefaults";

let cache: StageDefaults | undefined;

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(configDir(env), "stage-defaults.json");
}

// Read the override layer. Missing file, corrupt JSON, or an invalid per-entry value (unknown
// status, bad model, bad effort) all fall back to the built-in seed for that entry -- sanitizeOverrides
// drops only the bad entries, so a hand-edited file with one bad value doesn't lose the good ones.
// Cached in-process; the single Next.js process makes a module-level cache safe. Invalidated by
// writeOverrides and by _resetStageDefaultsCache (tests).
export function readOverrides(): StageDefaults {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(readFileSync(configPath(), "utf8"));
    cache = sanitizeOverrides(parsed);
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
