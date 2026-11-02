// Decisions for the terminal page of a session that lives on a peer (`/session/<id>?host=<peer>`).
// A peer's sessions come from its snapshot (`usePeers`), which holds live sessions only and is
// emptied when the peer goes offline, so what the page shows must outlive the snapshot's row.

import type { PeerSnapshot, SessionMeta } from "@mojito/shared";
import type { HostResolution } from "@/lib/host";

/**
 * The session to show: the snapshot's row, else the last one this page saw (an offline peer's
 * snapshot is empty, and a session that ends leaves it). `offline` only says the link is down.
 */
export function peerSessionView(
  peer: PeerSnapshot,
  id: string,
  lastKnown: SessionMeta | null,
): { session: SessionMeta | null; offline: boolean } {
  return { session: peer.sessions.find((s) => s.id === id) ?? lastKnown, offline: !peer.online };
}

/**
 * The session the terminal page is about. This instance's list is read only for `self`: while a
 * `?host=` is still resolving (or is unknown) the url's id may exist here too, and showing that
 * row would let the Git/Docs links and image uploads act on the wrong machine's session.
 */
export function pageSession(
  host: HostResolution,
  local: SessionMeta[] | undefined,
  id: string,
  lastKnown: SessionMeta | null,
): SessionMeta | null {
  switch (host.kind) {
    case "self":
      return local?.find((s) => s.id === id) ?? null;
    case "peer":
      return peerSessionView(host.peer, id, lastKnown).session;
    default:
      return null;
  }
}

/**
 * What the pty's 4404 means. Local: the session ended. A peer: the same only if this page ever
 * saw the session (`seen`); a 4404 on a cold load is an id the peer never had — a stale link or
 * a typo — and an "ended" panel would claim a session that never existed.
 */
export function exitAction(host: string | null, seen: boolean): "ended" | "board" {
  return host === null || seen ? "ended" : "board";
}
