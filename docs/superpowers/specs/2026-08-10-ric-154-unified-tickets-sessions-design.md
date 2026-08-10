# RIC-154 — Unify the Tickets and Sessions views

## Goal

Replace the two separate list screens (Tickets, Sessions) with a single list. The ticket
is the anchor row; its live sessions render nested inside its card. Sessions that belong
to no visible ticket get their own **No ticket** group. A new **Sessions** filter narrows
the list to what is running right now — every active session and terminal.

## Decisions taken with the user

1. **Shape** — tickets with nested session rows (not a flat merge, not a scope chip that
   swaps two lists).
2. **Ticket-less sessions** — always visible, in a **No ticket** group; not hidden behind
   the Sessions filter.
3. **Bottom nav** — the Sessions tab is removed. The nav becomes `Tickets | Stacks | ⚙`
   and the tab keeps the label "Tickets". The needs-input count moves onto that tab.

## Current state

- `src/app/page.tsx` already loads both `useTickets` and `useSessions` at page level and
  picks a list by `tab`. The merge needs no new data fetching.
- `TicketList` groups tickets by project → status, marks live work with a small `s-dot`,
  and opens `LaunchSheet` on tap.
- `SessionList` groups sessions the same way (with synthetic `Custom` / `Terminal` status
  buckets from `sessionFilter`), and owns Open / Docs / Kill per card plus *New session*
  and *Clean up*.
- Each list owns its own `FilterBar` state under its own localStorage keys.
- `FilterBar` has exactly two consumers, both of which this change absorbs — so it can be
  reshaped freely.

## Architecture

The repo has no React test setup: `vitest` runs in the `node` environment over
`tests/**/*.test.ts`, and pure logic lives in `src/lib/*.ts` (`ticketFilter`,
`sessionFilter`, `groupByStatus`, `orderSessions`, `ticketSessionLevel`). Components are
thin and untested by convention.

This design follows that split: **all merge logic goes into pure modules**, and the
components only render what those modules return.

### New pure modules

**`src/lib/activeSession.ts`**

```ts
/** A session that is still alive: starting | running | idle | needs-input. */
export function isActiveSession(s: SessionMeta): boolean;
```

The `running | needs-input | starting | idle` set is currently written out twice inside
`SessionList` and again, implicitly, in `activeSessionLevel`. One definition, reused by
all three callers.

**`src/lib/unifiedRows.ts`**

```ts
export interface TicketRow { ticket: TicketSummary; sessions: SessionMeta[] }
export interface UnifiedRows { ticketRows: TicketRow[]; looseSessions: SessionMeta[] }

export function buildUnifiedRows(input: {
  tickets: TicketSummary[];        // already scoped by mineOnly()
  sessions: SessionMeta[];
  filter: { query: string; project: string | null; status: string | null };
  sessionsOnly: boolean;
}): UnifiedRows;

/** Union of ticket statuses and session statuses, lifecycle-ranked, deduped. */
export function mergedStatuses(tickets: TicketSummary[], sessions: SessionMeta[]): string[];

/** Union of ticket and session project names, sorted. */
export function mergedProjects(tickets: TicketSummary[], sessions: SessionMeta[]): string[];
```

Both chip builders take the **mine-scoped** ticket list, matching how `TicketList` derives
its chips from `scoped` today, so toggling **Mine** never leaves a chip that matches
nothing. They take the full session list, which **Mine** does not scope.

`buildUnifiedRows` composes the existing helpers rather than reimplementing them:

1. `visible = filterTickets(tickets, filter)`.
2. For each visible ticket, attach every session whose `ticket` matches its identifier,
   ordered by `orderSessions`.
3. Any session not attached in step 2 is **loose**, and the loose set is filtered with the
   existing `filterSessions(loose, filter)`.
4. When `sessionsOnly` is on: keep only ticket rows with at least one `isActiveSession`,
   and only loose sessions that are `isActiveSession`.

**Sessions** is a further criterion, not a mode: it ANDs with the query, project, status
and **Mine** chips exactly as they AND with each other. With **Sessions** on and the
`Todo` chip active, the list shows Todo tickets that have something running. Decision 2
above — ticket-less sessions are always visible — is about the *default* view: they need
no filter to appear. Restricting them to the active ones is what turning **Sessions** on
asks for.

Step 3 is what guarantees no session can vanish. A session whose ticket is filtered out —
by the query, by a status chip, or by **Mine** — is not nested anywhere, so it falls into
the loose set and shows up under **No ticket**. That is a deliberate trade: the group name
is imprecise for those (they do have a ticket, and their card shows its identifier), but
losing a running session off the screen would be worse.

### Components

| File | Role |
| --- | --- |
| `src/components/UnifiedList.tsx` | **new** — replaces `TicketList`. Owns the single filter state, builds the groups, hosts `LaunchSheet` / `NewTicketSheet` / `NewSessionSheet`. |
| `src/components/TicketCard.tsx` | **new** — one ticket card with its nested session rows. |
| `src/components/SessionRow.tsx` | **new** — the compact nested row. |
| `src/components/SessionCard.tsx` | **new** — the full session card (Open / Docs / Kill), lifted out of `SessionList` for the **No ticket** group. |
| `src/components/TicketList.tsx` | **deleted** — absorbed by `UnifiedList`. |
| `src/components/SessionList.tsx` | **deleted** — absorbed by `UnifiedList` + `SessionCard`. |

`TicketCard` changes the card element from `<button>` to `<div className="card">` with a
`<div className="tap" onClick>` header, because nesting interactive rows inside a
`<button>` is invalid HTML. `SessionList` already uses exactly this pattern, so the CSS
carries over unchanged.

The ticket card drops the `s-dot` marker: with the sessions listed inline it would encode
the same fact twice. Instead, when `activeSessionLevel(...) === "attn"` the card takes the
existing `.card.attn` class, so a session waiting on input still colours its ticket.
`ticketSessionLevel` therefore stays in use, with its tests.

`SessionRow` is a tap target (opens the terminal) plus a `StateBadge` and one
Kill/Dismiss control — "Kill" while `isActiveSession`, "Dismiss" otherwise, with the same
`confirm()` copy `SessionList` uses today. It carries no Docs button: for a ticket session
the worktree is the ticket's, and `LaunchSheet` already has a Docs button that resolves
the same worktree. Loose sessions keep their Docs button on `SessionCard`, where the cwd
can differ.

### Layout

```
[ Search…                                    ]
[ + Ticket ] [ + Session ] [ Clean up ]
[All] [Mojito] [Other]
[Mine] [Sessions] [All] [Todo] [In Progress] [Custom] [Terminal]
─────────────────────────────────────────────
Mojito ──────────────────────────────────────
  Todo
  ┌───────────────────────────────────────┐
  │ RIC-154                               │
  │ Unify the Tickets and Sessions views  │
  │ ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  · │
  │  claude · work      [running]   Kill  │
  │  terminal           [idle]      Kill  │
  └───────────────────────────────────────┘
  ┌───────────────────────────────────────┐
  │ RIC-176                               │
  │ Post-refactor follow-ups              │
  └───────────────────────────────────────┘
  No ticket
  ┌───────────────────────────────────────┐
  │ scratch                    [running]  │
  │  Open      Docs      Kill             │
  └───────────────────────────────────────┘
```

Grouping keeps today's two levels — project section (`h4.sect`), then a status divider
(`div.substatus`) — and appends one more divider per project section:

- ticket rows, bucketed by `groupByStatus(rows, r => r.ticket.statusName)`;
- then, if that project has loose sessions, a **No ticket** divider followed by those
  sessions bucketed by `sessionStatus` so the `Custom` / `Terminal` dividers survive.

Sessions with no project keep falling under the existing `NO_PROJECT` ("No project")
section, as they do today. Project grouping stays in encounter order, matching both
current lists.

### Filter bar

`FilterBar` gains two things:

- a **Sessions** toggle chip beside **Mine** in the second chip row, `aria-pressed` like
  **Mine**;
- a `.filter-actions` row of its own for the `action` slot. The unified view needs three
  buttons and `.filter-top` is a non-wrapping flex row where `.search` is `flex: 1;
  min-width: 0` — a third button would crush the search field on a phone. The buttons
  move to their own row below the search and share it with `flex: 1`.

Filter state consolidates onto one set of keys — `mojito-list-q`, `mojito-list-project`,
`mojito-list-status`, `mojito-list-mine`, `mojito-list-sessions`. The old
`mojito-tickets-*` and `mojito-sessions-*` keys are abandoned, so filters reset once on
first load after the update. **Mine** keeps defaulting to on, **Sessions** defaults to off.

Chip options come from `mergedProjects` / `mergedStatuses` so a project or status that
only a session carries is still selectable — `Custom` and `Terminal` included.

### Page and nav

`page.tsx` renders `tab === "stacks" ? <StacksPanel/> : <UnifiedList/>`. Treating
everything that is not `"stacks"` as the unified list matters for migration: `mojito-tab`
is persisted, so a browser holding `"sessions"` from the previous version must not land on
a branch that no longer exists.

The needs-input count moves from the Sessions tab onto the Tickets tab, computed as it is
today (`sessions.filter(s => s.state === "needs-input").length`).

`tabTitle` loses its `"sessions"` branch and gains `"stacks" → "Stacks — Mojito"`; the
Stacks tab currently mislabels the browser tab as "Tickets — Mojito", and this function
and its test are being edited anyway.

## Data flow

Unchanged. `page.tsx` still owns `useTickets`, `useSessions`, `useEvents` and
`useSelfUpdate`; SSE events still call `refreshSessions()`, which now repaints nested rows
and the **No ticket** group in the same pass. `UnifiedList` receives `tickets`, `sessions`
and the existing callbacks (`onLaunched`, `onOpen`, `onOpenDocs`) plus `onChanged` for the
kill/sweep refresh that `SessionList` used to take.

## Error handling

No new failure modes. Kill and Clean up keep `SessionList`'s behaviour: a `confirm()`
prompt, then `DELETE /api/sessions/:id` or `POST /api/sessions/sweep`, then `onChanged()`.
Empty states:

- no tickets **and** no sessions → "Nothing here yet." with `+ New ticket` and
  `New session` buttons;
- filters match nothing → "No matching tickets or sessions.";
- **Sessions** on with nothing running → "No active sessions."

## Testing

New `tests/lib/activeSession.test.ts`:

- each of the six `SessionState` values classified correctly.

New `tests/lib/unifiedRows.test.ts`:

- sessions attach to their ticket and are ordered newest-first;
- a session whose ticket is filtered out (query, status, and **Mine** each) lands in
  `looseSessions` rather than disappearing — one case per filter, since this is the
  invariant the whole design rests on;
- a ticket-less custom/shell session is always loose;
- `sessionsOnly` drops session-less tickets and non-active loose sessions, and keeps a
  ticket whose only session is `needs-input`;
- `mergedStatuses` unions both sides, dedupes, and ranks lifecycle statuses before
  `Custom` / `Terminal`;
- `mergedProjects` unions both sides and includes `NO_PROJECT` when either side lacks one.

Updated `tests/lib/tabTitle.test.ts` for the dropped `sessions` branch and the new
`stacks` title.

`tests/lib/ticketSessionLevel.test.ts`, `ticketFilter.test.ts`, `sessionFilter.test.ts`,
`groupByStatus.test.ts` and `orderSessions.test.ts` all keep passing untouched — the
modules they cover are reused, not rewritten. That is the check that this is a
recomposition rather than a rewrite.

Full gate: `npx tsc --noEmit && npx vitest run`.

## Out of scope

- The Stacks tab and `StacksPanel`.
- `TerminalView`, `DocsView`, `LaunchSheet` and `NewSessionSheet` internals.
- Collapsing/expanding ticket cards. Tickets carry a handful of sessions at most, so
  nested rows always render.
- Any server-side change. This is a client-only recomposition.
