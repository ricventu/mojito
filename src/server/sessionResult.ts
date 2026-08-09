import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

// What a ticket session reports back at the end of its work. Written by the spawned
// session (the launch prompt names this exact path); read by the Stop/SessionEnd hook.
// "merged" is written only by the merge-fix session (an approved merge it completed
// itself); work sessions report "ready-for-qa" or "blocked".
export interface SessionResult {
  outcome: "ready-for-qa" | "merged" | "blocked";
  notes?: string;
}

export function resultPath(stateDir: string, id: string): string {
  const dir = join(stateDir, "results");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return join(dir, `${id}.json`);
}

// null on missing, unreadable, malformed, or unknown-outcome file — the caller treats
// all of those as "the session reported nothing".
export function readSessionResult(stateDir: string, id: string): SessionResult | null {
  try {
    const parsed = JSON.parse(readFileSync(resultPath(stateDir, id), "utf8")) as {
      outcome?: unknown;
      notes?: unknown;
    };
    if (parsed.outcome !== "ready-for-qa" && parsed.outcome !== "merged" && parsed.outcome !== "blocked") return null;
    return { outcome: parsed.outcome, ...(typeof parsed.notes === "string" ? { notes: parsed.notes } : {}) };
  } catch {
    return null;
  }
}

export function clearSessionResult(stateDir: string, id: string): void {
  try {
    rmSync(resultPath(stateDir, id));
  } catch {
    /* already gone */
  }
}
