# Ticket card host Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A ticket card shows its session's state and host wherever the session runs (RIC-617).

**Architecture:** Web only. A pure `cardSession` in `lib/peers.ts` picks the card's session and host from this instance's sessions and the peers snapshot; `StateBadge` gains a `host`; `filterBoard`'s `live` gets the peers' sessions too.

**Tech Stack:** React 19, TanStack Query, vitest (node).

**Spec:** `docs/superpowers/specs/2026-11-24-ticket-card-host-design.md`

## Global Constraints

- No server change. Copy is English. Tailwind utilities + shadcn only.
- Order of preference: live local → live on a peer → ended local (same as `TicketSheet`).
- `host` is null when there are no peers.

## Review Focus

- A local **ended** session and a **live** peer session for the same ticket: the card shows the peer's.
- Peers configured but all offline (snapshots empty): local sessions still name this instance.
- A peer session in `needs-input`: amber border and alert line on the card.
- `live=1` with only a peer session: the ticket stays.
- No peers at all: the card looks exactly as before (no `·`).

---

### Task 1: `cardSession`

**Files:** Modify `apps/web/src/lib/peers.ts`; Test `apps/web/test/lib/peers.test.ts`

**Interfaces:** Produces `cardSession(local: SessionMeta | null, peers: PeerSnapshot[], self: string | undefined, ticket: string): { session: SessionMeta; host: string | null } | null`

- [ ] Tests: live local wins over a peer's (host = self when peers exist); a peer's live beats a local ended one (host = peer name); ended local with no peer session; host null when `peers` is empty; null with nothing.
- [ ] Implement on top of `peerSessionForTicket`.
- [ ] `pnpm --filter web test peers` passes; commit.

### Task 2: Card and badge

**Files:** Modify `components/StateBadge.tsx` (optional `host?: string | null`, rendered muted after the label as `· host`), `components/board/TicketCard.tsx` (prop `host?: string | null`, passed to `StateBadge`), `components/board/ProjectSection.tsx` (`usePeers()`, `cardSession(sessionForTicket(...), peers, self, id)`).

- [ ] Typecheck; commit.

### Task 3: `live` filter counts peers

**Files:** Modify `components/board/Board.tsx` (third `filterBoard` argument = this instance's sessions + every peer's), `lib/board.ts` (docstring); Test `test/lib/board.test.ts`.

- [ ] Test: `live` keeps a ticket whose only session is in the passed list but not on the board's sections (a peer's).
- [ ] `pnpm test && pnpm typecheck`; commit; CLAUDE.md board paragraph updated.
