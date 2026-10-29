import type { Effort, Model, Settings } from "@mojito/shared";
import type { ApiError } from "@/lib/api";

/** Option labels; a `Record` over the unions so a model or effort added to `@mojito/shared` fails to compile until it is listed here. */
export const MODEL_LABELS: Record<Model, string> = { opus: "Opus", sonnet: "Sonnet", haiku: "Haiku", fable: "Fable" };
export const EFFORT_LABELS: Record<Effort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "XHigh",
  max: "Max",
};

/** What a launch starts from when nothing configured names the status. */
export const FALLBACK: { model: Model; effort: Effort } = { model: "opus", effort: "high" };

/** What the human picked by hand in the launch form; whatever is unset follows the status. */
export type LaunchPicks = Partial<{ model: Model; effort: Effort }>;

/**
 * The model and effort a ticket's launch form shows: the default of the ticket's status *now*
 * — after a status change in the sheet, the new status's — except where the human picked one.
 */
export function launchOptions(statusName: string, settings: Settings, picks: LaunchPicks = {}): { model: Model; effort: Effort } {
  const defaults = settings.statusDefaults[statusName] ?? FALLBACK;
  return { model: picks.model ?? defaults.model, effort: picks.effort ?? defaults.effort };
}

/**
 * What to do with a refused launch: a 409 that names a session means one is already live,
 * so the right move is to open it; anything else is shown as the server's own message.
 */
export function launchErrorAction(
  err: ApiError,
): { kind: "open"; sessionId: string } | { kind: "toast"; message: string } {
  const body = err.body;
  if (err.status === 409 && body && typeof body === "object" && "sessionId" in body && typeof body.sessionId === "string") {
    return { kind: "open", sessionId: body.sessionId };
  }
  return { kind: "toast", message: err.message };
}
