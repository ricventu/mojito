import { QaVerdictError, QA_ARGS, type QaArg, type QaVerdictResult } from "./qaVerdict.js";

export type VerdictResult =
  | { ok: true; result: QaVerdictResult }
  | { ok: false; code: 400 | 409 | 422; error: string };

export interface TicketVerdictDeps {
  getIssueStatus: (ticket: string) => Promise<string>;
  resolveVerdict: (input: { ticket: string; arg: QaArg }) => Promise<QaVerdictResult>;
  /**
   * Drops the ticket's work-session registration if its tmux is already gone. It never ends
   * a live session: a verdict is not a reason to kill the session the user may still be
   * typing into (see retireSession.ts).
   */
  retireStaleSession: (ticket: string) => Promise<void>;
}

/**
 * Resolve a To QA verdict keyed by ticket (no session required). Validates the arg and the
 * live status, delegates the merge/launch work to resolveVerdict, then clears the ticket's
 * work session if it is already dead. On any failure that cleanup is skipped so the caller
 * can retry.
 */
export async function resolveTicketVerdict(
  input: { ticket: string; arg: string },
  deps: TicketVerdictDeps,
): Promise<VerdictResult> {
  const { ticket, arg } = input;
  if (!QA_ARGS.includes(arg as QaArg)) return { ok: false, code: 400, error: "invalid arg" };

  const status = await deps.getIssueStatus(ticket);
  if (status !== "To QA") return { ok: false, code: 409, error: "ticket is not at To QA" };

  let result: QaVerdictResult;
  try {
    result = await deps.resolveVerdict({ ticket, arg: arg as QaArg });
  } catch (e) {
    const error = e instanceof Error ? e.message : "verdict failed";
    return { ok: false, code: e instanceof QaVerdictError ? 400 : 422, error };
  }

  await deps.retireStaleSession(ticket);
  return { ok: true, result };
}
