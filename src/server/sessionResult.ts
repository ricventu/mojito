import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

// What a ticket session reports back at the end of a round. Written by the spawned session
// (the launch prompt names this exact path); read by the Stop/SessionEnd hook. It exists only
// to move the ticket's status: "ready-for-qa" (work sessions) moves it to To QA, "merged"
// (only the merge-fix session, finishing an already-approved merge) moves it to Done. Anything
// a session wants to *say* it says in its terminal, which stays open for the human at To QA.
export interface SessionResult {
  outcome: "ready-for-qa" | "merged";
}

export function resultPath(stateDir: string, id: string): string {
  const dir = join(stateDir, "results");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return join(dir, `${id}.json`);
}

// null on missing, unreadable, malformed, or unknown-outcome file — the caller treats
// all of those as "the session reported nothing". Extra keys (e.g. a notes field from an
// older prompt) are ignored rather than rejected.
export function readSessionResult(stateDir: string, id: string): SessionResult | null {
  try {
    const parsed = JSON.parse(readFileSync(resultPath(stateDir, id), "utf8")) as { outcome?: unknown };
    if (parsed.outcome !== "ready-for-qa" && parsed.outcome !== "merged") return null;
    return { outcome: parsed.outcome };
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
