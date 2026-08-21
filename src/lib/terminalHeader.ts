import { isActiveState } from "@/lib/activeSession";
import { vscodeUrl, warpUrl } from "@/lib/openInApp";
import { ticketLinkUrl } from "@/lib/ticketLink";
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
  ticketUrl: string;  // the issue on Linear, or "" — see the `live` parameter and ticketLinkUrl
  warp: string;       // warp:// link to the session's cwd, or "" when there is no absolute one
  vscode: string;     // vscode:// link to the same directory
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

/**
 * `live` is this session's ticket as the polled ticket list currently has it, looked up
 * by the caller and passed in whole — Linear is the source of truth, and the ticket can
 * move status (or be edited) by hand there with no event Mojito sees. It carries two
 * things the sidecar cannot: the current status, which wins over the launch-time
 * snapshot `launchStatus` (see SessionMeta), and the issue's own url, which is what the
 * header's ticket id links to. Absent for a custom/shell session and for a ticket that
 * has left the open list (e.g. Done) — then the status falls back to the snapshot and
 * the id renders as plain text, since Mojito has no url to guess from.
 *
 * A `TicketSummary` satisfies the parameter as-is; it is spelled out structurally so
 * this module keeps depending on nothing but what it reads.
 */
export function terminalHeadModel(
  session: SessionMeta,
  live?: { statusName?: string; url?: string },
): TerminalHeadModel {
  const id = session.ticket?.trim() ?? "";
  const title = session.title?.trim() ?? "";
  const active = isActiveSession(session.state);
  const cwd = session.cwd ?? "";
  return {
    id,
    status: live?.statusName?.trim() || session.launchStatus?.trim() || "",
    title,
    name: id || title || "this session",
    killLabel: active ? "Kill" : "Dismiss",
    killDanger: active,
    ticketUrl: ticketLinkUrl(live?.url),
    warp: warpUrl(cwd),
    vscode: vscodeUrl(cwd),
  };
}
