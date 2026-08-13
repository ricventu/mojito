import { QaVerdictError, QA_ARGS, type QaArg, type QaVerdictResult } from "./qaVerdict.js";

export type VerdictResult =
  | { ok: true; result: QaVerdictResult }
  | { ok: false; code: 400 | 409 | 422; error: string };

export interface TicketVerdictDeps {
  getIssueStatus: (ticket: string) => Promise<string>;
  resolveVerdict: (input: { ticket: string; arg: QaArg }) => Promise<QaVerdictResult>;
  supersedeStaleSession: (ticket: string) => Promise<void>;
}

/**
 * Resolve a To QA verdict keyed by ticket (no session required). Validates the arg and the
 * live status, delegates the merge/launch work to resolveVerdict, then retires the ticket's
 * now-finished work session. On any failure the stale-session cleanup is skipped so the
 * caller can retry.
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

  await deps.supersedeStaleSession(ticket);
  return { ok: true, result };
}
