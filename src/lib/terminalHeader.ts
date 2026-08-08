import type { SessionMeta, SessionState } from "@/server/types";

/**
 * What the terminal header renders.
 *
 * The identity zone has to cope with sessions carrying very different amounts of
 * metadata: a ticket session has id, status and title; a custom session has only
 * a title; a shell session may have none of them; and sidecars written before
 * `title` existed can leave it `undefined` at runtime despite the type (see
 * SessionMeta). Every field is normalised to a string here so the component can
 * branch on emptiness alone.
 */
export interface TerminalHeadModel {
  id: string;         // "RIC-174", or "" when the session has no ticket
  status: string;     // Linear status at launch, or "" for custom/shell sessions
  title: string;      // Linear ticket title, or "" when unknown
  name: string;       // best human label for the kill confirm: id, else title, else a generic
  killLabel: string;  // "Kill" while the session can still be interrupted, else "Dismiss"
  killDanger: boolean;
}

/**
 * Can this session still be interrupted? "done" and "failed" ones are inert —
 * the button then only dismisses a leftover card, so it is not styled as
 * destructive.
 */
const ACTIVE: ReadonlySet<SessionState> = new Set<SessionState>([
  "starting",
  "running",
  "needs-input",
  "idle",
]);

export function isActiveSession(state: SessionState): boolean {
  return ACTIVE.has(state);
}

export function terminalHeadModel(session: SessionMeta): TerminalHeadModel {
  const id = session.ticket?.trim() ?? "";
  const title = session.title?.trim() ?? "";
  const active = isActiveSession(session.state);
  return {
    id,
    status: session.launchStatus?.trim() ?? "",
    title,
    name: id || title || "this session",
    killLabel: active ? "Kill" : "Dismiss",
    killDanger: active,
  };
}
