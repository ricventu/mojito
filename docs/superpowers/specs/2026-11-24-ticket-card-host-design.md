# Ticket card: the session's host and state, on any instance (RIC-617)

## Why

A ticket card shows its session's state only when the session runs on this instance. A ticket
running on a peer (the Mac, the box) shows no state at all, so the board reads as if nothing were
working on it, and nothing says where its agent is.

## Goals

- A card shows the state of its ticket's session wherever it runs.
- With peers configured, the state pill names the host: `Running · ai-tonic`.
- A peer session waiting for input is as visible as a local one: amber border, alert line.
- The active-sessions filter (`live=1`) keeps a ticket whose live session is on a peer.

## Non-goals

- No server change: `/api/peers` already carries every peer's live sessions.
- No ended session from a peer: its snapshot holds live sessions only.
- The ticket sheet is unchanged (it already shows "Session on <peer>").

## Approaches

1. **Web only, from the peers snapshot (chosen).** `cardSession` picks the card's session —
   a live local one, else a live one on a peer (`peerSessionForTicket`), else an ended local one,
   the order the ticket sheet already uses — and the host to name. Nothing new on the wire.
2. Have each server merge its peers' sessions into `/api/sessions`. Rejected: it echoes peer rows
   into a list the rest of the app reads as "this instance's", and peers are a client concern.

## Design

- `lib/peers.ts#cardSession(local, peers, self)` → `{ session, host } | null`; `host` is null when
  there are no peers (a single instance names nothing), else this instance's or the peer's name.
- `StateBadge` takes an optional `host`, shown muted after the state: `Running · mac`. Local
  sessions name their host too once peers exist: a bare `Running` beside `Running · mac` would
  still leave the reader guessing.
- `TicketCard` takes `host`; its amber border and alert already follow `session`, so a peer's
  needs-input gets them for free.
- `Board` passes `filterBoard` this instance's sessions plus the peers' (all live) for `live`.
