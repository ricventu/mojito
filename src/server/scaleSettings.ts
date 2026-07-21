import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

let cache: boolean | undefined;

export function scaleConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const dir = env.MOJITO_CONFIG_DIR
    ?? join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "mojito");
  return join(dir, "review-scale.json");
}

// Whether review launches at stage defaults may auto-scale down on small branches.
// Missing file, corrupt JSON, or a non-boolean value all mean the default: enabled.
// Cached in-process like stageDefaults; invalidated by writeAutoScale and _reset (tests).
export function readAutoScale(): boolean {
  if (cache !== undefined) return cache;
  let next: boolean;
  try {
    const parsed = JSON.parse(readFileSync(scaleConfigPath(), "utf8"));
    next = typeof parsed?.autoScale === "boolean" ? parsed.autoScale : true;
  } catch {
    next = true;
  }
  cache = next;
  return next;
}

export function writeAutoScale(next: boolean): void {
  const p = scaleConfigPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({ autoScale: next }, null, 2));
  cache = next;
}

export function _resetScaleSettingsCache(): void {
  cache = undefined;
}
