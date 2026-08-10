import { isActiveState } from "@/lib/activeSession";
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
 *
 * Delegates to activeSession.ts's isActiveState, the single definition of the
 * active-state set — this module used to keep its own copy of the same four states.
 * Kept as a same-named export, with this exact `(state: SessionState)` signature,
 * because TerminalView calls it; isActiveSession in activeSession.ts takes a full
 * `SessionMeta` instead, so passing one where the other is expected is a type error,
 * not a silent behaviour change.
 */
export function isActiveSession(state: SessionState): boolean {
  return isActiveState(state);
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
