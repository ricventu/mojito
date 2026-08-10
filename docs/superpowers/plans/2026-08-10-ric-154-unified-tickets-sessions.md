# RIC-154 — Unified Tickets + Sessions View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the separate Tickets and Sessions screens with one list where each ticket
card carries its live sessions inline, ticket-less sessions live in a "No ticket" group, and
a new Sessions filter narrows the list to what is running.

**Architecture:** All merge logic goes into two new pure modules (`src/lib/activeSession.ts`,
`src/lib/unifiedRows.ts`) that compose the existing tested helpers — `filterTickets`,
`filterSessions`, `orderSessions`, `orderTickets`, `groupByStatus`, `ticketStatuses`,
`sessionStatuses`. Four thin components render what those modules return. `TicketList` and
`SessionList` are deleted; `page.tsx` renders `UnifiedList` for every tab that is not
`stacks`.

**Tech Stack:** Next.js 15 (App Router, client components), React 19, TypeScript,
vitest (node environment), plain CSS in `src/app/globals.css`.

**Spec:** `docs/superpowers/specs/2026-08-10-ric-154-unified-tickets-sessions-design.md`

## Global Constraints

- **English only** in all identifiers, comments, commit messages and UI copy.
- **Tests are pure-logic only.** vitest runs `environment: "node"` over `tests/**/*.test.ts`.
  There is no React renderer and no `.tsx` test support — never write a component render test.
  Component tasks are verified by `npx tsc --noEmit`, the full suite, and `npm run build`.
- **Verification gate**, run from the worktree root: `npx tsc --noEmit && npx vitest run`.
  Baseline before this plan starts: 77 test files, 712 tests, 0 failures.
- **Test fixture style** — copy the existing factory pattern. `tests/lib/sessionFilter.test.ts`
  uses `function session(p: Partial<SessionMeta>): SessionMeta { return {...defaults, ...p} as SessionMeta }`
  and `tests/lib/ticketFilter.test.ts` uses the same shape for `TicketSummary`. Reuse it.
- **Import alias:** `@/` maps to `src/` (both in the app and in tests).
- **Do not touch:** `src/server/**`, `StacksPanel`, `TerminalView`, `DocsView`,
  `LaunchSheet` internals, `NewSessionSheet` internals. This is a client-only recomposition.
- **Existing CSS is reused, not replaced.** `.card`, `.card.attn`, `.card .tap`, `.row`,
  `.grow`, `.sect`, `.substatus`, `.chip`, `.chip.toggle`, `.chip.toggle.on`, `.filter`,
  `.filter-top`, `.filter-chips`, `.badge` all already exist and must keep working.

---

### Task 1: `isActiveSession` — one definition of "a session that is still alive"

The set `starting | running | idle | needs-input` is currently written out twice inside
`SessionList` and a third time, implicitly, in `activeSessionLevel`. Every later task needs
it, so it lands first.

**Files:**
- Create: `src/lib/activeSession.ts`
- Modify: `src/lib/ticketSessionLevel.ts`
- Test: `tests/lib/activeSession.test.ts`

**Interfaces:**
- Consumes: `SessionMeta`, `SessionState` from `@/server/types`.
- Produces: `isActiveSession(s: SessionMeta): boolean` — used by Tasks 2, 6, 7, 9.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/activeSession.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isActiveSession } from "@/lib/activeSession";
import type { SessionMeta, SessionState } from "@/server/types";

// minimal SessionMeta factory — only state matters here
function s(state: SessionState): SessionMeta {
  return {
    id: `mojito-RIC-1-${state}`, kind: "ticket", ticket: "RIC-1", state,
    launchStatus: "Todo", model: "opus", effort: "high",
    cwd: "", createdAt: "2026-08-10T10:00:00.000Z", title: "Title", labels: [],
  } as SessionMeta;
}

describe("isActiveSession", () => {
  it("counts starting, running and idle as active", () => {
    expect(isActiveSession(s("starting"))).toBe(true);
    expect(isActiveSession(s("running"))).toBe(true);
    expect(isActiveSession(s("idle"))).toBe(true);
  });

  it("counts needs-input as active — blocked, but the tmux is still there", () => {
    expect(isActiveSession(s("needs-input"))).toBe(true);
  });

  it("counts done and failed as finished", () => {
    expect(isActiveSession(s("done"))).toBe(false);
    expect(isActiveSession(s("failed"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/activeSession.test.ts`
Expected: FAIL — cannot resolve `@/lib/activeSession`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/activeSession.ts`:

```ts
import type { SessionMeta } from "@/server/types";

/**
 * Whether a session is still alive: starting/running/idle, plus needs-input — which is
 * a genuine block, but the tmux is still there and worth opening. done and failed are
 * finished.
 *
 * One definition, shared by the Sessions filter, the Kill/Dismiss label and
 * activeSessionLevel, each of which used to spell the same four states out for itself.
 */
export function isActiveSession(s: SessionMeta): boolean {
  return s.state === "starting" || s.state === "running"
    || s.state === "idle" || s.state === "needs-input";
}
```

- [ ] **Step 4: Reuse it in `activeSessionLevel`**

In `src/lib/ticketSessionLevel.ts`, add the import and replace the state-list line. The
`needs-input` early return above it makes `isActiveSession` exactly equivalent to the three
states it used to list:

```ts
import type { SessionMeta } from "@/server/types";
import { isActiveSession } from "@/lib/activeSession";

export type ActiveLevel = "attn" | "run";

/**
 * The active-session level for a ticket, or null when it has none.
 * "attn" (needs input) outranks "run" (running/starting/idle). done/failed are ignored.
 * A custom session resting at "idle" is still alive, so it counts as "run".
 * Only sessions whose `ticket` matches are considered.
 */
export function activeSessionLevel(
  ticket: string,
  sessions: SessionMeta[],
): ActiveLevel | null {
  let level: ActiveLevel | null = null;
  for (const ssn of sessions) {
    if (ssn.ticket !== ticket) continue;
    if (ssn.state === "needs-input") return "attn"; // highest priority — done early
    if (isActiveSession(ssn)) level = "run";
  }
  return level;
}
```

- [ ] **Step 5: Run the gate**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS. `tests/lib/ticketSessionLevel.test.ts` must still pass untouched — that is
the proof the refactor did not change behaviour.

- [ ] **Step 6: Commit**

```bash
git add src/lib/activeSession.ts src/lib/ticketSessionLevel.ts tests/lib/activeSession.test.ts
git commit -m "refactor(ric-154): one isActiveSession predicate for live sessions"
```

---

### Task 2: `buildUnifiedRows` — attach sessions to tickets, keep the rest loose

The core of the feature, and the one invariant everything rests on: **no session can vanish
from the screen.** Any session not nested under a visible ticket becomes a loose session.

**Files:**
- Create: `src/lib/unifiedRows.ts`
- Test: `tests/lib/unifiedRows.test.ts`

**Interfaces:**
- Consumes: `isActiveSession` (Task 1); `filterTickets` from `@/lib/ticketFilter`;
  `filterSessions` from `@/lib/sessionFilter`; `orderSessions` from `@/lib/orderSessions`;
  `orderTickets` from `@/lib/orderTickets`.
- Produces, all used by Task 9:
  - `interface TicketRow { ticket: TicketSummary; sessions: SessionMeta[] }`
  - `interface UnifiedRows { ticketRows: TicketRow[]; looseSessions: SessionMeta[] }`
  - `interface UnifiedFilter { query: string; project: string | null; status: string | null }`
  - `buildUnifiedRows(input: { tickets: TicketSummary[]; sessions: SessionMeta[]; filter: UnifiedFilter; sessionsOnly: boolean }): UnifiedRows`
  - `orderTicketRows(rows: TicketRow[]): TicketRow[]`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/unifiedRows.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildUnifiedRows, orderTicketRows } from "@/lib/unifiedRows";
import type { SessionMeta, TicketSummary } from "@/server/types";

function ticket(p: Partial<TicketSummary>): TicketSummary {
  return {
    identifier: "RIC-1",
    title: "Title",
    statusName: "Todo",
    statusType: "unstarted",
    project: "Mojito",
    labels: [],
    assignedToMe: true,
    ...p,
  };
}

function session(p: Partial<SessionMeta>): SessionMeta {
  return {
    kind: "ticket",
    id: "mojito-RIC-1-work",
    ticket: "RIC-1",
    launchStatus: "Todo",
    model: "opus",
    effort: "high",
    state: "running",
    cwd: "",
    createdAt: "2026-08-10T10:00:00.000Z",
    projectName: "Mojito",
    title: "Title",
    labels: [],
    ...p,
  } as SessionMeta;
}

const NO_FILTER = { query: "", project: null, status: null };

describe("buildUnifiedRows", () => {
  it("returns a row per ticket with no sessions attached when there are none", () => {
    const rows = buildUnifiedRows({
      tickets: [ticket({ identifier: "RIC-1" })], sessions: [],
      filter: NO_FILTER, sessionsOnly: false,
    });
    expect(rows.ticketRows).toHaveLength(1);
    expect(rows.ticketRows[0].sessions).toEqual([]);
    expect(rows.looseSessions).toEqual([]);
  });

  it("nests a session under its own ticket", () => {
    const rows = buildUnifiedRows({
      tickets: [ticket({ identifier: "RIC-1" }), ticket({ identifier: "RIC-2" })],
      sessions: [session({ id: "a", ticket: "RIC-2" })],
      filter: NO_FILTER, sessionsOnly: false,
    });
    expect(rows.ticketRows[0].sessions).toEqual([]);
    expect(rows.ticketRows[1].sessions.map((s) => s.id)).toEqual(["a"]);
    expect(rows.looseSessions).toEqual([]);
  });

  it("orders a ticket's sessions newest first", () => {
    const rows = buildUnifiedRows({
      tickets: [ticket({ identifier: "RIC-1" })],
      sessions: [
        session({ id: "old", createdAt: "2026-08-01T10:00:00.000Z" }),
        session({ id: "new", createdAt: "2026-08-09T10:00:00.000Z" }),
      ],
      filter: NO_FILTER, sessionsOnly: false,
    });
    expect(rows.ticketRows[0].sessions.map((s) => s.id)).toEqual(["new", "old"]);
  });

  it("treats a ticket-less session as loose", () => {
    const rows = buildUnifiedRows({
      tickets: [ticket({ identifier: "RIC-1" })],
      sessions: [session({ id: "shell", kind: "shell", ticket: "", launchStatus: "" })],
      filter: NO_FILTER, sessionsOnly: false,
    });
    expect(rows.ticketRows[0].sessions).toEqual([]);
    expect(rows.looseSessions.map((s) => s.id)).toEqual(["shell"]);
  });

  // The query narrows the loose set on the session's own fields, exactly as the old
  // session list did. A session that matches the search survives its ticket being hidden.
  it("keeps a session loose when the query hides its ticket but matches the session", () => {
    const rows = buildUnifiedRows({
      tickets: [ticket({ identifier: "RIC-1", title: "Alpha", statusName: "Todo" })],
      sessions: [session({ id: "a", ticket: "RIC-1", model: "fable" })],
      filter: { query: "fable", project: null, status: null }, sessionsOnly: false,
    });
    expect(rows.ticketRows).toEqual([]);
    expect(rows.looseSessions.map((s) => s.id)).toEqual(["a"]);
  });

  // The other side of the same rule, and the reason the query is not neutralised for
  // ticket-bearing sessions: if it were, searching for one ticket would drop every other
  // ticket's sessions into the "No ticket" group.
  it("drops a session when the query matches neither it nor its ticket", () => {
    const rows = buildUnifiedRows({
      tickets: [ticket({ identifier: "RIC-1", title: "Alpha" })],
      sessions: [session({ id: "a", ticket: "RIC-1" })],
      filter: { query: "zzz", project: null, status: null }, sessionsOnly: false,
    });
    expect(rows.ticketRows).toEqual([]);
    expect(rows.looseSessions).toEqual([]);
  });

  // The ticket has moved on since its session launched, so a status chip can hide the
  // ticket while the session still matches. It must survive, under "No ticket".
  it("keeps a session loose when a status chip hides its ticket but not the session", () => {
    const rows = buildUnifiedRows({
      tickets: [ticket({ identifier: "RIC-1", statusName: "Todo" })],
      sessions: [session({ id: "a", ticket: "RIC-1", launchStatus: "In Progress" })],
      filter: { query: "", project: null, status: "In Progress" }, sessionsOnly: false,
    });
    expect(rows.ticketRows).toEqual([]);
    expect(rows.looseSessions.map((s) => s.id)).toEqual(["a"]);
  });

  it("drops a session the status chip excludes on its own merits", () => {
    const rows = buildUnifiedRows({
      tickets: [ticket({ identifier: "RIC-1", statusName: "Todo" })],
      sessions: [session({ id: "a", ticket: "RIC-1", launchStatus: "Todo" })],
      filter: { query: "", project: null, status: "In Progress" }, sessionsOnly: false,
    });
    expect(rows.ticketRows).toEqual([]);
    expect(rows.looseSessions).toEqual([]);
  });

  it("keeps a session loose when Mine has already scoped its ticket out", () => {
    // Mine is applied by the caller (mineOnly), so it reaches buildUnifiedRows as a
    // ticket that simply is not in the list.
    const rows = buildUnifiedRows({
      tickets: [],
      sessions: [session({ id: "a", ticket: "RIC-1" })],
      filter: NO_FILTER, sessionsOnly: false,
    });
    expect(rows.ticketRows).toEqual([]);
    expect(rows.looseSessions.map((s) => s.id)).toEqual(["a"]);
  });

  it("filters loose sessions by project and query like the old session list did", () => {
    const sessions = [
      session({ id: "a", ticket: "", kind: "custom", projectName: "Mojito", title: "alpha" }),
      session({ id: "b", ticket: "", kind: "custom", projectName: "Other", title: "beta" }),
    ];
    expect(buildUnifiedRows({
      tickets: [], sessions, filter: { query: "", project: "Other", status: null }, sessionsOnly: false,
    }).looseSessions.map((s) => s.id)).toEqual(["b"]);
    expect(buildUnifiedRows({
      tickets: [], sessions, filter: { query: "alpha", project: null, status: null }, sessionsOnly: false,
    }).looseSessions.map((s) => s.id)).toEqual(["a"]);
  });
});

describe("buildUnifiedRows with sessionsOnly", () => {
  it("drops tickets that have no active session", () => {
    const rows = buildUnifiedRows({
      tickets: [ticket({ identifier: "RIC-1" }), ticket({ identifier: "RIC-2" })],
      sessions: [session({ id: "a", ticket: "RIC-2", state: "running" })],
      filter: NO_FILTER, sessionsOnly: true,
    });
    expect(rows.ticketRows.map((r) => r.ticket.identifier)).toEqual(["RIC-2"]);
  });

  it("drops a ticket whose only session is finished", () => {
    const rows = buildUnifiedRows({
      tickets: [ticket({ identifier: "RIC-1" })],
      sessions: [session({ id: "a", ticket: "RIC-1", state: "done" })],
      filter: NO_FILTER, sessionsOnly: true,
    });
    expect(rows.ticketRows).toEqual([]);
  });

  it("keeps a ticket whose only session needs input", () => {
    const rows = buildUnifiedRows({
      tickets: [ticket({ identifier: "RIC-1" })],
      sessions: [session({ id: "a", ticket: "RIC-1", state: "needs-input" })],
      filter: NO_FILTER, sessionsOnly: true,
    });
    expect(rows.ticketRows.map((r) => r.ticket.identifier)).toEqual(["RIC-1"]);
  });

  it("keeps only active loose sessions", () => {
    const rows = buildUnifiedRows({
      tickets: [],
      sessions: [
        session({ id: "live", ticket: "", kind: "shell", state: "running", launchStatus: "" }),
        session({ id: "dead", ticket: "", kind: "shell", state: "failed", launchStatus: "" }),
      ],
      filter: NO_FILTER, sessionsOnly: true,
    });
    expect(rows.looseSessions.map((s) => s.id)).toEqual(["live"]);
  });
});

describe("orderTicketRows", () => {
  it("orders rows newest-identifier first, numeric-aware", () => {
    const rows = [
      { ticket: ticket({ identifier: "RIC-9" }), sessions: [] },
      { ticket: ticket({ identifier: "RIC-114" }), sessions: [] },
      { ticket: ticket({ identifier: "RIC-20" }), sessions: [] },
    ];
    expect(orderTicketRows(rows).map((r) => r.ticket.identifier))
      .toEqual(["RIC-114", "RIC-20", "RIC-9"]);
  });

  it("does not mutate the input", () => {
    const rows = [
      { ticket: ticket({ identifier: "RIC-1" }), sessions: [] },
      { ticket: ticket({ identifier: "RIC-2" }), sessions: [] },
    ];
    orderTicketRows(rows);
    expect(rows.map((r) => r.ticket.identifier)).toEqual(["RIC-1", "RIC-2"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/unifiedRows.test.ts`
Expected: FAIL — cannot resolve `@/lib/unifiedRows`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/unifiedRows.ts`:

```ts
import type { SessionMeta, TicketSummary } from "@/server/types";
import { filterTickets } from "@/lib/ticketFilter";
import { filterSessions } from "@/lib/sessionFilter";
import { orderSessions } from "@/lib/orderSessions";
import { orderTickets } from "@/lib/orderTickets";
import { isActiveSession } from "@/lib/activeSession";

/** A ticket and the sessions that belong to it, rendered nested inside its card. */
export interface TicketRow {
  ticket: TicketSummary;
  sessions: SessionMeta[];
}

export interface UnifiedRows {
  ticketRows: TicketRow[];
  /** Sessions not nested under any visible ticket — the "No ticket" group. */
  looseSessions: SessionMeta[];
}

export interface UnifiedFilter {
  query: string;
  project: string | null;
  status: string | null;
}

/**
 * The unified list model: visible tickets with their sessions attached, plus every
 * session that did not find a home.
 *
 * `tickets` must already be scoped by mineOnly() — the Mine toggle is a scope, not a
 * criterion, so the chips can be derived from the scoped list (see mergedStatuses).
 *
 * The loose set is what makes the merge safe when something structural hides a ticket —
 * Mine scoping it out, or the ticket not being among the ones fetched. Its session is
 * nested nowhere, so instead of disappearing it falls through to "No ticket", where its
 * card still shows the ticket identifier.
 *
 * The loose set is still narrowed by the query, project and status chips on the session's
 * own fields, exactly as the old session list narrowed it. Neutralising the query here
 * would mean searching for one ticket dumped every other ticket's sessions into
 * "No ticket".
 */
export function buildUnifiedRows(
  { tickets, sessions, filter, sessionsOnly }: {
    tickets: TicketSummary[];
    sessions: SessionMeta[];
    filter: UnifiedFilter;
    sessionsOnly: boolean;
  },
): UnifiedRows {
  const visible = filterTickets(tickets, filter);
  const nested = new Set<string>();
  let ticketRows: TicketRow[] = visible.map((ticket) => {
    const own = sessions.filter((s) => s.ticket === ticket.identifier);
    for (const s of own) nested.add(s.id);
    return { ticket, sessions: orderSessions(own) };
  });
  let looseSessions = filterSessions(sessions.filter((s) => !nested.has(s.id)), filter);

  if (sessionsOnly) {
    ticketRows = ticketRows.filter((r) => r.sessions.some(isActiveSession));
    looseSessions = looseSessions.filter(isActiveSession);
  }
  return { ticketRows, looseSessions };
}

/**
 * Order ticket rows the way orderTickets orders tickets (newest identifier first,
 * numeric-aware), by delegating to it rather than restating the comparison.
 * Returns a new array; does not mutate the input.
 */
export function orderTicketRows(rows: TicketRow[]): TicketRow[] {
  const byId = new Map(rows.map((r) => [r.ticket.identifier, r]));
  return orderTickets(rows.map((r) => r.ticket)).map((t) => byId.get(t.identifier)!);
}
```

- [ ] **Step 4: Run the gate**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS, with the new `unifiedRows` tests green and every pre-existing test untouched.

- [ ] **Step 5: Commit**

```bash
git add src/lib/unifiedRows.ts tests/lib/unifiedRows.test.ts
git commit -m "feat(ric-154): build the unified ticket+session row model"
```

---

### Task 3: `mergedStatuses` and `mergedProjects` — filter chips over both sides

The unified filter bar needs chips covering tickets *and* sessions, so a project that only
holds a terminal, or the synthetic `Custom` / `Terminal` status buckets, stay selectable.

**Files:**
- Modify: `src/lib/unifiedRows.ts`
- Test: `tests/lib/unifiedRows.test.ts`

**Interfaces:**
- Consumes: `ticketStatuses`, `NO_PROJECT` from `@/lib/ticketFilter`; `sessionStatuses` from
  `@/lib/sessionFilter`; `statusRank` from `@/lib/status`.
- Produces, both used by Task 9:
  - `mergedStatuses(tickets: TicketSummary[], sessions: SessionMeta[]): string[]`
  - `mergedProjects(tickets: TicketSummary[], sessions: SessionMeta[]): string[]`

- [ ] **Step 1: Write the failing test**

Append to `tests/lib/unifiedRows.test.ts` (the `ticket` and `session` factories are already
defined at the top of the file from Task 2; extend the import on line 2 to
`import { buildUnifiedRows, orderTicketRows, mergedStatuses, mergedProjects } from "@/lib/unifiedRows";`):

```ts
describe("mergedStatuses", () => {
  it("returns [] when there is nothing", () => {
    expect(mergedStatuses([], [])).toEqual([]);
  });

  it("unions ticket and session statuses without duplicates", () => {
    const statuses = mergedStatuses(
      [ticket({ statusName: "Todo" }), ticket({ statusName: "In Progress" })],
      [session({ launchStatus: "Todo" })],
    );
    expect(statuses).toEqual(["Todo", "In Progress"]);
  });

  it("ranks lifecycle statuses before the synthetic Custom and Terminal buckets", () => {
    const statuses = mergedStatuses(
      [ticket({ statusName: "To QA" }), ticket({ statusName: "Backlog" })],
      [
        session({ kind: "custom", ticket: "", launchStatus: "" }),
        session({ kind: "shell", ticket: "", launchStatus: "" }),
      ],
    );
    expect(statuses).toEqual(["Backlog", "To QA", "Custom", "Terminal"]);
  });

  it("drops empty statuses", () => {
    expect(mergedStatuses([ticket({ statusName: "" })], [])).toEqual([]);
  });
});

describe("mergedProjects", () => {
  it("unions ticket and session project names, sorted", () => {
    expect(mergedProjects(
      [ticket({ project: "Mojito" })],
      [session({ projectName: "Atlas" })],
    )).toEqual(["Atlas", "Mojito"]);
  });

  it("includes the no-project sentinel when either side lacks a project", () => {
    expect(mergedProjects([ticket({ project: null })], [])).toEqual(["No project"]);
    expect(mergedProjects([], [session({ projectName: null })])).toEqual(["No project"]);
  });

  it("does not duplicate a project both sides carry", () => {
    expect(mergedProjects(
      [ticket({ project: "Mojito" })],
      [session({ projectName: "Mojito" })],
    )).toEqual(["Mojito"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/unifiedRows.test.ts`
Expected: FAIL — `mergedStatuses is not a function`.

- [ ] **Step 3: Write the implementation**

Add to `src/lib/unifiedRows.ts` — extend the existing import block with
`import { filterTickets, ticketStatuses, NO_PROJECT } from "@/lib/ticketFilter";`,
`import { filterSessions, sessionStatuses } from "@/lib/sessionFilter";` and
`import { statusRank } from "@/lib/status";`, then append:

```ts
/**
 * Distinct statuses across tickets and sessions, ordered by lifecycle rank (unknown
 * ones — including the synthetic Custom and Terminal buckets — last, alphabetical
 * tie-break). Same comparison ticketStatuses and sessionStatuses each apply on their
 * own side, so a merged chip row stays in lifecycle order.
 *
 * `tickets` is the mine-scoped list, matching how the old ticket list derived its chips:
 * toggling Mine must never leave a chip that matches nothing. Sessions are not scoped
 * by Mine, so the full list comes in.
 */
export function mergedStatuses(tickets: TicketSummary[], sessions: SessionMeta[]): string[] {
  const all = new Set([...ticketStatuses(tickets), ...sessionStatuses(sessions)]);
  return Array.from(all)
    .filter((v) => v !== "")
    .sort((a, b) => {
      const byRank = statusRank(a) - statusRank(b);
      return byRank !== 0 ? byRank : a.localeCompare(b);
    });
}

/** Distinct project names across tickets and sessions, with NO_PROJECT for either side's blanks. */
export function mergedProjects(tickets: TicketSummary[], sessions: SessionMeta[]): string[] {
  return Array.from(new Set([
    ...tickets.map((t) => t.project ?? NO_PROJECT),
    ...sessions.map((s) => s.projectName ?? NO_PROJECT),
  ])).sort();
}
```

- [ ] **Step 4: Run the gate**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/unifiedRows.ts tests/lib/unifiedRows.test.ts
git commit -m "feat(ric-154): merge ticket and session filter chip options"
```

---

### Task 4: `tabTitle` — drop the Sessions title, name the Stacks tab

**Files:**
- Modify: `src/lib/tabTitle.ts`
- Test: `tests/lib/tabTitle.test.ts`

**Interfaces:**
- Produces: `tabTitle(tab: string): string`, unchanged signature. Task 10 keeps calling it.

- [ ] **Step 1: Rewrite the test**

Replace the body of `tests/lib/tabTitle.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { tabTitle } from "@/lib/tabTitle";

describe("tabTitle", () => {
  it("titles the unified tickets tab", () => {
    expect(tabTitle("tickets")).toBe("Tickets — Mojito");
  });

  it("titles the stacks tab", () => {
    expect(tabTitle("stacks")).toBe("Stacks — Mojito");
  });

  it("falls back to the tickets title for any other value", () => {
    expect(tabTitle("")).toBe("Tickets — Mojito");
    expect(tabTitle("whatever")).toBe("Tickets — Mojito");
  });

  // A browser that stored "sessions" before the views merged must land on the unified
  // list, which is what page.tsx renders for every value that is not "stacks".
  it("gives a stored 'sessions' tab the tickets title", () => {
    expect(tabTitle("sessions")).toBe("Tickets — Mojito");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/tabTitle.test.ts`
Expected: FAIL — `tabTitle("stacks")` returns `"Tickets — Mojito"` and `tabTitle("sessions")`
returns `"Sessions — Mojito"`.

- [ ] **Step 3: Write the implementation**

Replace `src/lib/tabTitle.ts` entirely:

```ts
// Browser document title for the two remaining list tabs, mirroring how an open
// terminal reflects its ticket in the tab (see terminalTabTitle). Anything other than
// "stacks" is the unified tickets+sessions list — including a "sessions" value still
// stored by a browser from before the two views merged.
export function tabTitle(tab: string): string {
  return tab === "stacks" ? "Stacks — Mojito" : "Tickets — Mojito";
}
```

- [ ] **Step 4: Run the gate**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tabTitle.ts tests/lib/tabTitle.test.ts
git commit -m "feat(ric-154): title the stacks tab, drop the sessions title"
```

---

### Task 5: `FilterBar` — a Sessions toggle and a row of its own for the actions

The unified bar needs three action buttons. `.filter-top` is a non-wrapping flex row where
`.search` is `flex: 1; min-width: 0`, so a third button would crush the search field on a
phone. The actions move to their own row.

`FilterBar` has only two consumers today (`TicketList`, `SessionList`) and Task 10 deletes
both, so reshaping it is safe. Until then the app still compiles: both new props are
optional and the `action` slot keeps working, it just renders one row lower.

**Files:**
- Modify: `src/components/FilterBar.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Produces: `FilterBar` gains two optional props consumed by Task 9 —
  `sessionsOnly?: boolean` and `onSessionsOnly?: (v: boolean) => void`.

- [ ] **Step 1: Add the props and the actions row**

Replace `src/components/FilterBar.tsx` entirely:

```tsx
"use client";
export { NO_PROJECT } from "@/lib/ticketFilter";

export default function FilterBar(
  { query, onQuery, projects, active, onProject, statuses, activeStatus, onStatus,
    mine, onMine, sessionsOnly, onSessionsOnly, placeholder, action }:
  {
    query: string;
    onQuery: (q: string) => void;
    projects: string[];
    active: string | null;
    onProject: (p: string | null) => void;
    statuses?: string[];
    activeStatus?: string | null;
    onStatus?: (s: string | null) => void;
    mine?: boolean;
    onMine?: (v: boolean) => void;
    sessionsOnly?: boolean;
    onSessionsOnly?: (v: boolean) => void;
    placeholder?: string;
    action?: React.ReactNode;
  },
) {
  const hasStatuses = statuses != null && onStatus != null
    && (statuses.length > 0 || (activeStatus ?? null) !== null);
  return (
    <div className="filter">
      <div className="filter-top">
        <input
          className="search"
          type="search"
          inputMode="search"
          placeholder={placeholder ?? "Search…"}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
        />
      </div>
      {/* The actions get their own row: the unified list needs three of them, and
          .filter-top does not wrap — a third button there would squeeze the search
          field down to nothing on a phone. */}
      {action && <div className="filter-actions">{action}</div>}
      {(projects.length > 0 || active !== null) && (
        <div className="filter-chips">
          <button className={`chip toggle${active === null ? " on" : ""}`} onClick={() => onProject(null)}>All</button>
          {projects.map((p) => (
            <button key={p} className={`chip toggle${active === p ? " on" : ""}`} onClick={() => onProject(p)}>{p}</button>
          ))}
        </div>
      )}
      {(hasStatuses || onMine || onSessionsOnly) && (
        <div className="filter-chips">
          {/* The scope toggles lead the row: .filter-chips scrolls horizontally, so a
              trailing toggle would sit off-screen on a phone once the statuses fill the
              width. "lead" carries the gap and belongs on the last of them. */}
          {onMine && (
            <button
              className={`chip toggle${!onSessionsOnly ? " lead" : ""}${mine ? " on" : ""}`}
              aria-pressed={mine}
              onClick={() => onMine(!mine)}
            >
              Mine
            </button>
          )}
          {onSessionsOnly && (
            <button
              className={`chip toggle lead${sessionsOnly ? " on" : ""}`}
              aria-pressed={sessionsOnly}
              onClick={() => onSessionsOnly(!sessionsOnly)}
            >
              Sessions
            </button>
          )}
          {hasStatuses && (
            <>
              <button className={`chip toggle${(activeStatus ?? null) === null ? " on" : ""}`} onClick={() => onStatus!(null)}>All</button>
              {statuses!.map((s) => (
                <button
                  key={s}
                  className={`chip toggle${activeStatus === s ? " on" : ""}`}
                  onClick={() => onStatus!(s)}
                >
                  {s}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the CSS**

In `src/app/globals.css`, immediately after the `.filter-top .search` rule (around line 117),
insert:

```css
.filter-actions { display: flex; gap: 8px; margin-top: 8px; }
.filter-actions .btn { flex: 1; min-width: 0; }
```

- [ ] **Step 3: Run the gate**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS. No test covers `FilterBar` — it is a component, and this repo has no React
renderer. The typecheck is the check that both existing callers still satisfy the props.

- [ ] **Step 4: Commit**

```bash
git add src/components/FilterBar.tsx src/app/globals.css
git commit -m "feat(ric-154): add a Sessions toggle and an actions row to the filter bar"
```

---

### Task 6: `SessionRow` — the compact nested row

**Files:**
- Create: `src/components/SessionRow.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `isActiveSession` (Task 1); `StateBadge` from `./StateBadge`.
- Produces: default export `SessionRow`, props
  `{ session: SessionMeta; onOpen: () => void; onDismiss: () => void }`. Used by Task 8.

- [ ] **Step 1: Write the component**

Create `src/components/SessionRow.tsx`:

```tsx
"use client";
import StateBadge from "./StateBadge";
import { isActiveSession } from "@/lib/activeSession";
import type { SessionMeta } from "@/server/types";

/**
 * A session shown inside its ticket's card. The ticket identifier is on the card
 * already, so the row leads with what the card cannot say: which kind of session this
 * is and which model is driving it.
 */
function rowLabel(s: SessionMeta): string {
  if (s.kind === "shell") return "terminal";
  return `${s.kind === "custom" ? "claude" : "work"} · ${s.model}`;
}

export default function SessionRow(
  { session, onOpen, onDismiss }:
  { session: SessionMeta; onOpen: () => void; onDismiss: () => void },
) {
  const active = isActiveSession(session);
  return (
    <div className="srow">
      <div className="srow-tap" onClick={onOpen}>
        <div className="row">
          <span className="srow-label">{rowLabel(session)}</span>
          <span className="grow" />
          <StateBadge state={session.state} />
        </div>
        {session.message && <div className="srow-msg">{session.message}</div>}
      </div>
      <button
        className={`btn sm${active ? " danger" : ""}`}
        onClick={onDismiss}
      >
        {active ? "Kill" : "Dismiss"}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Add the CSS**

In `src/app/globals.css`, append after the `.card .meta` rule (around line 93):

```css
.card .srows { margin-top: 10px; border-top: 1px solid var(--border); }
.srow { display: flex; align-items: center; gap: 8px; padding: 8px 0 0; }
.srow-tap { flex: 1; min-width: 0; cursor: pointer; }
.srow-tap:active { transform: scale(.99); }
.srow-label { font: 600 12px/1.3 var(--mono); color: var(--text-dim); }
.srow-msg { margin-top: 2px; font-size: 12px; color: var(--text-dim); }
.srow .btn { flex: none; }
```

- [ ] **Step 3: Run the gate**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS. `SessionRow` is not imported anywhere yet — the typecheck is confirming it
compiles on its own.

- [ ] **Step 4: Commit**

```bash
git add src/components/SessionRow.tsx src/app/globals.css
git commit -m "feat(ric-154): add the nested session row"
```

---

### Task 7: `SessionCard` — the full card, lifted out of `SessionList`

The card for the **No ticket** group. This is `SessionList`'s existing card markup extracted
verbatim so the loose sessions keep the Open / Docs / Kill actions and the `Custom` /
`Terminal` presentation they have today.

**Files:**
- Create: `src/components/SessionCard.tsx`

**Interfaces:**
- Consumes: `isActiveSession` (Task 1); `StateBadge` from `./StateBadge`.
- Produces: default export `SessionCard`, props
  `{ session: SessionMeta; onOpen: () => void; onOpenDocs: () => void; onDismiss: () => void }`.
  Used by Task 9.

- [ ] **Step 1: Write the component**

Create `src/components/SessionCard.tsx` — the JSX is `SessionList.tsx:86-122` with the
handlers turned into props:

```tsx
"use client";
import StateBadge from "./StateBadge";
import { isActiveSession } from "@/lib/activeSession";
import type { SessionMeta } from "@/server/types";

/**
 * A session with no visible ticket to nest under — a bare claude session, a plain
 * terminal, or one whose ticket the current filters hide. Keeps its own Docs button:
 * unlike a ticket session, its cwd is not necessarily a ticket worktree.
 */
export default function SessionCard(
  { session: s, onOpen, onOpenDocs, onDismiss }:
  { session: SessionMeta; onOpen: () => void; onOpenDocs: () => void; onDismiss: () => void },
) {
  const active = isActiveSession(s);
  return (
    <div className={`card${s.state === "needs-input" ? " attn" : ""}`}>
      <div className="tap" onClick={onOpen}>
        {s.kind === "custom" || s.kind === "shell" ? (
          <>
            <div className="row">
              <span className="session-title">{s.title}</span>
              <span className="grow" />
              <StateBadge state={s.state} />
            </div>
            {s.message && <div className="title">{s.message}</div>}
          </>
        ) : (
          <>
            <div className="row">
              <span className="id">{s.ticket}</span>
              <span className="grow" />
              <StateBadge state={s.state} />
            </div>
            {s.title && <div className="session-title">{s.title}</div>}
            {s.message && <div className="title">{s.message}</div>}
          </>
        )}
        <div className="meta">
          {s.kind !== "shell" && <span className="chip">{s.model} · {s.effort}</span>}
          {s.kind === "shell" && <span className="chip">terminal</span>}
        </div>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn ghost sm grow" onClick={onOpen}>Open</button>
        <button className="btn ghost sm" onClick={onOpenDocs}>Docs</button>
        <button className={`btn sm${active ? " danger" : ""}`} onClick={onDismiss}>
          {active ? "Kill" : "Dismiss"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run the gate**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/SessionCard.tsx
git commit -m "feat(ric-154): extract the standalone session card"
```

---

### Task 8: `TicketCard` — a ticket with its sessions inside

**Files:**
- Create: `src/components/TicketCard.tsx`

**Interfaces:**
- Consumes: `TicketRow` (Task 2); `SessionRow` (Task 6); `showsMineMarker` from
  `@/lib/ticketFilter`; `activeSessionLevel` from `@/lib/ticketSessionLevel`.
- Produces: default export `TicketCard`, props
  `{ row: TicketRow; mine: boolean; onPick: () => void; onOpenSession: (s: SessionMeta) => void; onDismissSession: (s: SessionMeta) => void }`.
  Used by Task 9.

- [ ] **Step 1: Write the component**

Create `src/components/TicketCard.tsx`:

```tsx
"use client";
import SessionRow from "./SessionRow";
import { showsMineMarker } from "@/lib/ticketFilter";
import { activeSessionLevel } from "@/lib/ticketSessionLevel";
import type { SessionMeta } from "@/server/types";
import type { TicketRow } from "@/lib/unifiedRows";

/**
 * A ticket card with its live sessions listed inside it.
 *
 * The card is a div, not a button as the old ticket list had it: nesting the session
 * rows' own controls inside a button is invalid HTML. The header keeps the whole-area
 * tap that opens LaunchSheet, the same way the session cards have always done it.
 *
 * There is no s-dot here. With the sessions listed inline it would state the same fact
 * twice; instead a session waiting on input colours the whole card via .card.attn.
 */
export default function TicketCard(
  { row, mine, onPick, onOpenSession, onDismissSession }: {
    row: TicketRow;
    mine: boolean;
    onPick: () => void;
    onOpenSession: (s: SessionMeta) => void;
    onDismissSession: (s: SessionMeta) => void;
  },
) {
  const { ticket, sessions } = row;
  const attn = activeSessionLevel(ticket.identifier, sessions) === "attn";
  return (
    <div className={`card${attn ? " attn" : ""}`}>
      <div className="tap" onClick={onPick}>
        <div>
          <span className="id">{ticket.identifier}</span>
          {showsMineMarker(ticket, mine) && <span className="chip mine">Mine</span>}
        </div>
        <div className="title">{ticket.title}</div>
        {ticket.labels.length > 0 && (
          <div className="meta">{ticket.labels.map((l) => <span key={l} className="chip">{l}</span>)}</div>
        )}
      </div>
      {sessions.length > 0 && (
        <div className="srows">
          {sessions.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              onOpen={() => onOpenSession(s)}
              onDismiss={() => onDismissSession(s)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run the gate**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/TicketCard.tsx
git commit -m "feat(ric-154): add the ticket card with nested sessions"
```

---

### Task 9: `UnifiedList` — the single list

**Files:**
- Create: `src/components/UnifiedList.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `buildUnifiedRows`, `orderTicketRows`, `mergedProjects`, `mergedStatuses`,
  `TicketRow` (Tasks 2–3); `isActiveSession` (Task 1); `TicketCard` (Task 8);
  `SessionCard` (Task 7); `FilterBar` + its two new props (Task 5); and the existing
  `LaunchSheet`, `NewTicketSheet`, `NewSessionSheet`, `StatusBadge`, `mineOnly`,
  `sessionStatus`, `groupByStatus`, `orderSessions`, `usePersistedState`, `apiFetch`.
- Produces: default export `UnifiedList`, props
  `{ token: string; tickets: TicketSummary[]; sessions: SessionMeta[]; onLaunched: () => void; onChanged: () => void; onOpen: (s: SessionMeta) => void; onOpenTicketDocs: (t: TicketSummary) => void; onOpenSessionDocs: (s: SessionMeta) => void }`.
  Used by Task 10.

- [ ] **Step 1: Write the component**

Create `src/components/UnifiedList.tsx`:

```tsx
"use client";
import { useMemo, useState } from "react";
import { apiFetch } from "@/lib/client";
import LaunchSheet from "./LaunchSheet";
import NewTicketSheet from "./NewTicketSheet";
import NewSessionSheet from "./NewSessionSheet";
import FilterBar from "./FilterBar";
import TicketCard from "./TicketCard";
import SessionCard from "./SessionCard";
import StatusBadge from "./StatusBadge";
import { mineOnly, NO_PROJECT } from "@/lib/ticketFilter";
import { sessionStatus } from "@/lib/sessionFilter";
import { groupByStatus } from "@/lib/groupByStatus";
import { orderSessions } from "@/lib/orderSessions";
import { isActiveSession } from "@/lib/activeSession";
import { usePersistedState } from "@/lib/usePersistedState";
import {
  buildUnifiedRows, mergedProjects, mergedStatuses, orderTicketRows, type TicketRow,
} from "@/lib/unifiedRows";
import type { SessionMeta, TicketSummary } from "@/server/types";

/** Divider label for the sessions that hang off no visible ticket. */
const NO_TICKET = "No ticket";

export default function UnifiedList(
  { token, tickets, sessions, onLaunched, onChanged, onOpen, onOpenTicketDocs, onOpenSessionDocs }: {
    token: string;
    tickets: TicketSummary[];
    sessions: SessionMeta[];
    onLaunched: () => void;
    onChanged: () => void;
    onOpen: (s: SessionMeta) => void;
    onOpenTicketDocs: (t: TicketSummary) => void;
    onOpenSessionDocs: (s: SessionMeta) => void;
  },
) {
  const [picked, setPicked] = useState<TicketSummary | null>(null);
  const [newTicket, setNewTicket] = useState(false);
  const [newSession, setNewSession] = useState(false);

  // One set of filter keys for the merged list. The old mojito-tickets-* and
  // mojito-sessions-* keys are abandoned, so filters reset once after the update.
  const [query, setQuery] = usePersistedState("mojito-list-q", "");
  const [projectRaw, setProjectRaw] = usePersistedState("mojito-list-project", "");
  const project = projectRaw === "" ? null : projectRaw;
  const setProject = (p: string | null) => setProjectRaw(p ?? "");
  const [statusRaw, setStatusRaw] = usePersistedState("mojito-list-status", "");
  const status = statusRaw === "" ? null : statusRaw;
  const setStatus = (s: string | null) => setStatusRaw(s ?? "");
  // Default on, as it was on the ticket list before the merge.
  const [mineRaw, setMineRaw] = usePersistedState("mojito-list-mine", "1");
  const mine = mineRaw !== "0";
  const setMine = (v: boolean) => setMineRaw(v ? "1" : "0");
  // Default off: the full board is the landing view.
  const [sessionsRaw, setSessionsRaw] = usePersistedState("mojito-list-sessions", "0");
  const sessionsOnly = sessionsRaw === "1";
  const setSessionsOnly = (v: boolean) => setSessionsRaw(v ? "1" : "0");

  // Mine is a scope, applied before everything else so the chips below describe only
  // the tickets that can actually appear.
  const scoped = useMemo(() => mineOnly(tickets, mine), [tickets, mine]);
  const projects = useMemo(() => mergedProjects(scoped, sessions), [scoped, sessions]);
  const statuses = useMemo(() => mergedStatuses(scoped, sessions), [scoped, sessions]);

  const { ticketRows, looseSessions } = useMemo(
    () => buildUnifiedRows({
      tickets: scoped, sessions, filter: { query, project, status }, sessionsOnly,
    }),
    [scoped, sessions, query, project, status, sessionsOnly],
  );

  // Bucket both kinds by project, in encounter order — tickets first, so a project that
  // only holds a loose session lands after the ones with tickets. Both lists preserve
  // Map insertion order.
  const byProject = useMemo(() => {
    const t = new Map<string, TicketRow[]>();
    const s = new Map<string, SessionMeta[]>();
    const order: string[] = [];
    const note = (name: string) => { if (!order.includes(name)) order.push(name); };
    for (const row of ticketRows) {
      const name = row.ticket.project ?? NO_PROJECT;
      note(name);
      const list = t.get(name);
      if (list) list.push(row);
      else t.set(name, [row]);
    }
    for (const ssn of looseSessions) {
      const name = ssn.projectName ?? NO_PROJECT;
      note(name);
      const list = s.get(name);
      if (list) list.push(ssn);
      else s.set(name, [ssn]);
    }
    return { order, tickets: t, sessions: s };
  }, [ticketRows, looseSessions]);

  const dismiss = async (s: SessionMeta) => {
    const label = s.ticket || s.title;
    const prompt = isActiveSession(s)
      ? `Kill the running session for ${label}?`
      : `Dismiss the session for ${label}?`;
    if (!confirm(prompt)) return;
    await apiFetch(token, `/api/sessions/${s.id}`, { method: "DELETE" });
    onChanged();
  };

  const cleanup = async () => {
    if (!confirm("Remove all orphaned sessions (their tmux is gone)?")) return;
    await apiFetch(token, "/api/sessions/sweep", { method: "POST" });
    onChanged();
  };

  const empty = tickets.length === 0 && sessions.length === 0;
  const noMatches = !empty && ticketRows.length === 0 && looseSessions.length === 0;

  return (
    <div className="pad">
      {empty && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p className="empty">Nothing here yet.</p>
          <button className="btn primary block" onClick={() => setNewTicket(true)}>+ New ticket</button>
          <button className="btn ghost block" onClick={() => setNewSession(true)}>New session</button>
        </div>
      )}
      {!empty && (
        <FilterBar
          query={query} onQuery={setQuery}
          projects={projects} active={project} onProject={setProject}
          statuses={statuses} activeStatus={status} onStatus={setStatus}
          mine={mine} onMine={setMine}
          sessionsOnly={sessionsOnly} onSessionsOnly={setSessionsOnly}
          placeholder="Filter tickets and sessions…"
          action={
            <>
              <button className="btn primary sm" onClick={() => setNewTicket(true)}>+ Ticket</button>
              <button className="btn ghost sm" onClick={() => setNewSession(true)}>+ Session</button>
              <button className="btn ghost sm" onClick={cleanup}>Clean up</button>
            </>
          }
        />
      )}
      {noMatches && (
        <p className="empty">
          {sessionsOnly ? "No active sessions." : "No matching tickets or sessions."}
        </p>
      )}
      {byProject.order.map((proj) => (
        <section key={proj}>
          <h4 className="sect">{proj}</h4>
          {groupByStatus(byProject.tickets.get(proj) ?? [], (r) => r.ticket.statusName).map((group) => (
            <div key={group.status}>
              <div className="substatus"><StatusBadge status={group.status} /></div>
              {orderTicketRows(group.items).map((row) => (
                <TicketCard
                  key={row.ticket.identifier}
                  row={row}
                  mine={mine}
                  onPick={() => setPicked(row.ticket)}
                  onOpenSession={onOpen}
                  onDismissSession={dismiss}
                />
              ))}
            </div>
          ))}
          {(byProject.sessions.get(proj)?.length ?? 0) > 0 && (
            <>
              <div className="substatus"><span className="sub-label">{NO_TICKET}</span></div>
              {groupByStatus(byProject.sessions.get(proj)!, sessionStatus).map((group) => (
                <div key={group.status}>
                  {group.status && <div className="substatus"><StatusBadge status={group.status} /></div>}
                  {orderSessions(group.items).map((s) => (
                    <SessionCard
                      key={s.id}
                      session={s}
                      onOpen={() => onOpen(s)}
                      onOpenDocs={() => onOpenSessionDocs(s)}
                      onDismiss={() => dismiss(s)}
                    />
                  ))}
                </div>
              ))}
            </>
          )}
        </section>
      ))}
      {picked && (
        <LaunchSheet token={token} ticket={picked} sessions={sessions}
          onClose={() => setPicked(null)} onLaunched={onLaunched}
          onOpen={(s) => { setPicked(null); onOpen(s); }}
          onOpenDocs={() => { setPicked(null); onOpenTicketDocs(picked); }} />
      )}
      {newTicket && (
        <NewTicketSheet token={token} onClose={() => setNewTicket(false)} onCreated={onLaunched} />
      )}
      {newSession && (
        <NewSessionSheet token={token} onClose={() => setNewSession(false)} onLaunched={onChanged} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the CSS for the "No ticket" divider**

In `src/app/globals.css`, immediately after the `.substatus` rule (around line 110), insert:

```css
.sub-label {
  font: 600 11px/1 var(--mono); color: var(--text-dim);
  text-transform: uppercase; letter-spacing: .06em;
}
```

- [ ] **Step 3: Run the gate**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS. `UnifiedList` is not mounted yet; this confirms every prop and import lines up.

- [ ] **Step 4: Commit**

```bash
git add src/components/UnifiedList.tsx src/app/globals.css
git commit -m "feat(ric-154): add the unified tickets and sessions list"
```

---

### Task 10: Wire up the page, drop the Sessions tab, delete the old lists

**Files:**
- Modify: `src/app/page.tsx`
- Delete: `src/components/TicketList.tsx`
- Delete: `src/components/SessionList.tsx`

**Interfaces:**
- Consumes: `UnifiedList` (Task 9), `tabTitle` (Task 4).
- Produces: nothing further — this is the last task.

- [ ] **Step 1: Swap the list and the nav in `page.tsx`**

In `src/app/page.tsx`:

Replace the two list imports

```tsx
import TicketList from "@/components/TicketList";
import SessionList from "@/components/SessionList";
```

with

```tsx
import UnifiedList from "@/components/UnifiedList";
```

Replace the whole three-way list ternary (currently lines 74–81) with:

```tsx
      {tab === "stacks"
        ? <StacksPanel token={token} onOpenLogs={setOpen} selfUpdate={selfUpdate} />
        : <UnifiedList token={token} tickets={tickets} sessions={sessions}
            onLaunched={() => { refreshSessions(); refreshTickets(); }}
            onChanged={refreshSessions}
            onOpen={setOpen}
            onOpenTicketDocs={(t) => setDocsFor({ target: { ticket: t.identifier, project: t.project }, label: t.identifier })}
            onOpenSessionDocs={(s) => setDocsFor({ target: { session: s.id }, label: s.ticket || s.title })} />}
```

Replace the `<nav>` block (currently lines 82–89) with:

```tsx
      {/* Anything that is not "stacks" is the unified list, so a browser still holding
          the removed "sessions" value in mojito-tab lands somewhere real. */}
      <nav className="nav">
        <button className={`tab${tab !== "stacks" ? " active" : ""}`} onClick={() => setTab("tickets")}>
          Tickets{needsInput ? <span className="count">{needsInput}</span> : null}
        </button>
        <button className={`tab${tab === "stacks" ? " active" : ""}`} onClick={() => setTab("stacks")}>Stacks</button>
        <button className="tab settings" aria-label="Settings" onClick={() => setSettingsOpen(true)}>⚙</button>
      </nav>
```

Leave everything else alone — `useTickets`, `useSessions`, `useEvents`, `useSelfUpdate`, the
`needsInput` count, `AlertLayer`, `SettingsSheet`, the `TerminalView` / `DocsView` early
returns and the `document.title` effect are all unchanged.

- [ ] **Step 2: Delete the superseded lists**

```bash
git rm src/components/TicketList.tsx src/components/SessionList.tsx
```

- [ ] **Step 3: Verify nothing still imports them**

Run: `grep -rn "TicketList\|SessionList" src/ tests/`
Expected: no output.

- [ ] **Step 4: Run the full gate plus a production build**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: typecheck clean; every test passing (712 baseline + the new `activeSession`,
`unifiedRows` and rewritten `tabTitle` cases); `next build` succeeding. The build is the
only check that the new components actually render — there is no React test environment
here, so a bad hook order or an invalid nesting would otherwise reach QA unseen.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ric-154): render one unified list and retire the Sessions tab"
```

---

## Verification summary

| Check | Command |
| --- | --- |
| Types | `npx tsc --noEmit` |
| Tests | `npx vitest run` |
| Render | `npm run build` |

Manual QA (human, after the branch merges — the app needs a Linear token and a tmux host):
tickets show their sessions nested; tapping a nested row opens that terminal; tapping the
card opens `LaunchSheet`; a bare terminal appears under **No ticket**; the **Sessions**
chip leaves only live work on screen; the bottom nav shows `Tickets | Stacks | ⚙` with the
needs-input count on Tickets.
