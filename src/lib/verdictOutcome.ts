import type { QaVerdictResult } from "@/server/qaVerdict";

// The two verdict outcomes worth holding the sheet open for: the ones that carry
// information the user cannot get anywhere else (the MR URL, and the fact that a
// merge conflict happened). Anything else — including a body from a server that
// predates or postdates this client — closes the sheet, so a version skew degrades
// to the old behaviour instead of showing a blank panel.
export type HeldOutcome = Extract<QaVerdictResult, { done: "mr-created" | "conflict-session" }>;

export function holdsSheetOpen(r: unknown): r is HeldOutcome {
  if (r === null || typeof r !== "object") return false;
  const done = (r as { done?: unknown }).done;
  if (done === "mr-created") return typeof (r as { url?: unknown }).url === "string";
  if (done === "conflict-session") return typeof (r as { sessionId?: unknown }).sessionId === "string";
  return false;
}
