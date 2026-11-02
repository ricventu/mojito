// Decisions for the terminal page of a session that lives on a peer (`/session/<id>?host=<peer>`).
// A peer's sessions come from its snapshot (`usePeers`), which holds live sessions only and is
// emptied when the peer goes offline, so what the page shows must outlive the snapshot's row.

import type { PeerSnapshot, SessionMeta } from "@mojito/shared";

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
 * What the pty's 4404 means. Local: the session ended. A peer: the same only if this page ever
 * saw the session (`seen`); a 4404 on a cold load is an id the peer never had — a stale link or
 * a typo — and an "ended" panel would claim a session that never existed.
 */
export function exitAction(host: string | null, seen: boolean): "ended" | "board" {
  return host === null || seen ? "ended" : "board";
}
