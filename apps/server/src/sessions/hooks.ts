import type { SessionKind } from "@mojito/shared";
import type { SessionsRepo } from "../db/sessions";
import type { EventBus } from "../events/bus";
import type { TicketCache } from "../tickets/cache";
import { PREFIX } from "../tmux/tmux";
import { hookPayload, isHookEvent, isNoiseHook, mapHook } from "./hookMap";

const TICKET_ID = /^[A-Z][A-Z0-9]*-\d+$/;

/** The ticket a tmux name belongs to (`mj-RIC-12` -> `RIC-12`), or null for a free session. */
export function ticketFromId(id: string): string | null {
  if (!id.startsWith(PREFIX)) return null;
  const rest = id.slice(PREFIX.length);
  return TICKET_ID.test(rest) ? rest : null;
}

/**
 * The kind is not stored anywhere but the id once a row is gone, so adoption reads it from
 * there. A shell cannot be told from a claude session by its name; it is adopted as claude.
 */
export function kindFromId(id: string): SessionKind {
  return ticketFromId(id) ? "ticket" : "claude";
}

export interface HookDeps {
  sessions: SessionsRepo;
  bus: EventBus;
  tickets: TicketCache;
  now(): number;
}

/**
 * Apply one Claude Code hook to its session. Never throws: it runs behind an endpoint whose
 * `curl` ends in `|| true`, and a bad hook must not be able to fail claude or the server.
 * Unknown ids and unknown events are ignored, and so is any event for an `ended` session and
 * any hook `isNoiseHook` rules out (a `/clear`'s SessionEnd, an idle Notification). `body` is
 * the hook's own JSON; missing or unparseable, it reads as an empty payload.
 *
 * A hook that maps to the state and alert the row already has (PostToolUse fires on every
 * tool call) refreshes `lastEventAt` but emits nothing: no client-visible field but the
 * timestamp changed, and a broadcast per tool call is noise for every open board.
 */
export function handleHook(id: string, event: string, deps: HookDeps, body?: unknown): void {
  try {
    if (!isHookEvent(event)) return;
    if (isNoiseHook(event, hookPayload(body))) return;
    const before = deps.sessions.get(id);
    if (!before || before.state === "ended") return;
    const next = mapHook(event, before.state);
    const changed = next.state !== before.state || next.alert !== before.alert;
    const session = deps.sessions.patch(id, { state: next.state, alert: next.alert, lastEventAt: deps.now() });
    if (changed && session) deps.bus.emit({ type: "session.updated", session });
    // The session moves its own ticket in Linear; a finished turn is when that may have happened.
    if (event === "Stop" && before.kind === "ticket") void deps.tickets.refresh();
  } catch (err) {
    console.error("hook handling failed", err);
  }
}
