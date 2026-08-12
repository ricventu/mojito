# Stale filter visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an active list filter evident wherever the user is scrolled to, and make a session launch report that it is happening.

**Architecture:** A pure `activeFilters` model in `src/lib/` turns the five filter values into a list of `{key, label}` entries; a presentational `ActiveFilters` component renders them as a `position: sticky` bar that `UnifiedList` mounts under the existing `FilterBar`. Separately, `LaunchSheet`'s three launch handlers gain the pending state and `try`/`catch` that `submitVerdict` beside them already has, plus a shared `apiError` helper that reads a route's JSON `{ error }` instead of dumping raw JSON at the user.

**Tech Stack:** Next.js 16 (client components), React 19, TypeScript, plain CSS in `src/app/globals.css`, vitest (node environment).

**Spec:** `docs/superpowers/specs/2026-08-12-stale-filter-visibility-design.md`

## Global Constraints

- All code artifacts in English — identifiers, comments, commit messages.
- Test command: `npx tsc --noEmit && npx vitest run`.
- **Baseline is not green.** Before this work: **750 passing, 2 failing.** The two failures
  are pre-existing and unrelated — `tests/server/docFiles.test.ts` compares against a raw
  `mkdtemp` path while `resolveDocPath` calls `realpathSync`, which resolves macOS's
  `/var` → `/private/var` symlink. Do **not** fix them here. The passing count must go up
  and the failing count must stay at exactly 2.
- vitest environment is **node** and `include` is `["tests/**/*.test.ts"]` — no DOM, no
  testing-library, no `.tsx` collected. Test pure functions only; never render a component
  or a hook in a test.
- Components in this codebase are untested by design. Put logic worth testing in
  `src/lib/` and keep the component a dumb renderer.
- Comments explain *why*, not *what* — match the density and voice of the surrounding
  files (see `src/lib/unifiedRows.ts` for the house style).
- Commit after each task.

---

### Task 1: The `activeFilters` model

The pure function that decides which filters are narrowing the list. Everything else in
this plan consumes it.

**Files:**
- Create: `src/lib/activeFilters.ts`
- Test: `tests/lib/activeFilters.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type FilterKey = "query" | "project" | "status" | "mine" | "sessions"`
  - `interface ActiveFilter { key: FilterKey; label: string }`
  - `interface FilterState { query: string; project: string | null; status: string | null; mine: boolean; sessionsOnly: boolean }`
  - `function activeFilters(state: FilterState): ActiveFilter[]`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/activeFilters.test.ts`. The `state()` factory defaults every filter to
off, which is the landing state once Task 3 flips Mine — so each test names only the
filter it is about.

```ts
import { describe, it, expect } from "vitest";
import { activeFilters, type FilterState } from "@/lib/activeFilters";

// Every filter off — the landing state once Mine defaults off (Task 3). Each test
// overrides only the filter it is about.
function state(p: Partial<FilterState> = {}): FilterState {
  return { query: "", project: null, status: null, mine: false, sessionsOnly: false, ...p };
}

describe("activeFilters", () => {
  it("returns [] when nothing narrows the list", () => {
    expect(activeFilters(state())).toEqual([]);
  });

  it("reports a query under its trimmed text", () => {
    expect(activeFilters(state({ query: "  182 " }))).toEqual([{ key: "query", label: "182" }]);
  });

  it("treats a whitespace-only query as absent, as filterTickets does", () => {
    expect(activeFilters(state({ query: "   " }))).toEqual([]);
  });

  it("reports a project under its own name", () => {
    expect(activeFilters(state({ project: "Mojito" })))
      .toEqual([{ key: "project", label: "Mojito" }]);
  });

  it("labels the No project sentinel as-is, since it is the chip's own value", () => {
    expect(activeFilters(state({ project: "No project" })))
      .toEqual([{ key: "project", label: "No project" }]);
  });

  it("reports a status under its own name", () => {
    expect(activeFilters(state({ status: "To QA" })))
      .toEqual([{ key: "status", label: "To QA" }]);
  });

  it("labels the Mine toggle", () => {
    expect(activeFilters(state({ mine: true }))).toEqual([{ key: "mine", label: "Mine" }]);
  });

  it("labels the Sessions toggle", () => {
    expect(activeFilters(state({ sessionsOnly: true })))
      .toEqual([{ key: "sessions", label: "Sessions" }]);
  });

  it("counts an empty-string project or status as set, since only null is unset", () => {
    expect(activeFilters(state({ project: "", status: "" }))).toEqual([
      { key: "project", label: "" },
      { key: "status", label: "" },
    ]);
  });

  it("orders every filter query-first, so the one that scrolls away leads", () => {
    const all = state({
      query: "182", project: "Mojito", status: "To QA", mine: true, sessionsOnly: true,
    });
    expect(activeFilters(all).map((f) => f.key))
      .toEqual(["query", "project", "status", "mine", "sessions"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/activeFilters.test.ts`

Expected: FAIL — `Failed to resolve import "@/lib/activeFilters"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/activeFilters.ts`. It needs no imports — it reads five plain values and
returns plain objects:

```ts
/** Identifies which of the unified list's five filters an entry came from. */
export type FilterKey = "query" | "project" | "status" | "mine" | "sessions";

/** One filter currently narrowing the list, and the text that names it to the user. */
export interface ActiveFilter {
  key: FilterKey;
  label: string;
}

/** The unified list's filter values, exactly as UnifiedList holds them. */
export interface FilterState {
  query: string;
  project: string | null;
  status: string | null;
  mine: boolean;
  sessionsOnly: boolean;
}

/**
 * The filters currently narrowing the unified list, query first — it is the one that
 * scrolls out of sight behind the list, so it leads the sticky bar that reports them.
 *
 * An empty array means the list is showing everything. That is what lets ActiveFilters
 * decide on its own whether to render, instead of every caller testing five values.
 *
 * `query` is a bare string, so emptiness is how it says "unset" — trimmed, to match
 * filterTickets and filterSessions, which both narrow on `query.trim()`. `project` and
 * `status` are `string | null`, where only `null` says it: `""` is a value like any
 * other. UnifiedList maps its persisted `""` to `null` before calling here, so the two
 * conventions never meet.
 */
export function activeFilters(
  { query, project, status, mine, sessionsOnly }: FilterState,
): ActiveFilter[] {
  const active: ActiveFilter[] = [];
  const trimmed = query.trim();
  if (trimmed !== "") active.push({ key: "query", label: trimmed });
  if (project !== null) active.push({ key: "project", label: project });
  if (status !== null) active.push({ key: "status", label: status });
  if (mine) active.push({ key: "mine", label: "Mine" });
  if (sessionsOnly) active.push({ key: "sessions", label: "Sessions" });
  return active;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/activeFilters.test.ts`

Expected: PASS, 10 tests.

- [ ] **Step 5: Typecheck and run the whole suite**

Run: `npx tsc --noEmit && npx vitest run`

Expected: `TypeScript: No errors found`, then **760 passing, 2 failing** (the two
pre-existing `resolveDocPath` failures, unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/lib/activeFilters.ts tests/lib/activeFilters.test.ts
git commit -m "feat(filters): model which filters are narrowing the list"
```

---

### Task 2: The sticky `ActiveFilters` bar

Renders Task 1's output as a bar that stays on screen, and wires it into the list.

**Files:**
- Create: `src/components/ActiveFilters.tsx`
- Modify: `src/app/globals.css` — insert after the `.filter-chips .chip.lead` rule (line 140), before the `/* ---- Chips (labels / meta) ---- */` heading
- Modify: `src/components/UnifiedList.tsx` — imports, one `useMemo`, two handlers, one JSX mount

**Interfaces:**
- Consumes: `activeFilters`, `ActiveFilter`, `FilterKey` from Task 1.
- Produces: default-exported `ActiveFilters` component taking
  `{ filters: ActiveFilter[]; onClear: (key: FilterKey) => void; onClearAll: () => void }`.

- [ ] **Step 1: Write the component**

Create `src/components/ActiveFilters.tsx`:

```tsx
"use client";
import type { ActiveFilter, FilterKey } from "@/lib/activeFilters";

/**
 * The sticky report of what is narrowing the list.
 *
 * It exists because FilterBar scrolls away: with it off screen a filtered list is
 * indistinguishable from a complete one, and the "No matching tickets or sessions."
 * hint only fires when *nothing* matches — never in the case that bites, where the
 * ticket you searched for is right there and the session you just launched is not.
 *
 * Renders nothing when nothing is filtered, so that condition lives here instead of
 * spread across UnifiedList.
 */
export default function ActiveFilters(
  { filters, onClear, onClearAll }:
  { filters: ActiveFilter[]; onClear: (key: FilterKey) => void; onClearAll: () => void },
) {
  if (filters.length === 0) return null;
  return (
    <div className="active-filters">
      {/* A row of lime chips would otherwise read as another FilterBar row rather than
          as a warning that things are hidden. One word settles it. */}
      <span className="af-lead">Filtered</span>
      {filters.map((f) => (
        <button
          key={f.key}
          className="chip af-chip"
          // The label alone is not a usable name for a button whose job is removal.
          aria-label={`Remove filter ${f.label}`}
          onClick={() => onClear(f.key)}
        >
          <span className="af-text">{f.label}</span>
          <span className="af-x" aria-hidden="true">✕</span>
        </button>
      ))}
      {/* With a single filter its own ✕ is already clear-all, so a second control
          would only be noise. */}
      {filters.length > 1 && (
        <button className="chip af-all" onClick={onClearAll}>Clear all</button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the CSS**

In `src/app/globals.css`, insert this block immediately after the
`.filter-chips .chip.lead { margin-right: 14px; }` rule and before the
`/* ---- Chips (labels / meta) ---- */` heading:

```css
/* ---- Active filter bar (sticky) ---- */
/* Pinned, unlike .filter above, which scrolls away: with the filter bar off screen a
   filtered list looks like a complete one, which is how a leftover search query hid a
   freshly launched session. z-index sits under .nav (40) and the sheets (100); no
   ancestor sets overflow or transform, so `sticky` resolves against the viewport. The
   negative margin cancels .pad's padding so the bar spans the full width and its
   bottom border reads as a divider. */
.active-filters {
  position: sticky; top: 0; z-index: 30;
  margin: 0 -12px 8px; padding: 8px 12px;
  background: var(--surface); border-bottom: 1px solid var(--border);
  display: flex; align-items: center; gap: 6px;
  overflow-x: auto; scrollbar-width: none;
}
.active-filters::-webkit-scrollbar { display: none; }
.active-filters .chip { flex: none; }
.af-lead {
  flex: none; font: 600 10px/1 var(--sans); letter-spacing: .06em;
  text-transform: uppercase; color: var(--text-faint);
}
/* Brand lime, matching .filter-chips .chip.on — these are the active filters. Spelled
   out rather than reusing the `on` class, whose unscoped .chip.on rule is blue and
   outranks a single class. */
.af-chip {
  max-width: 46vw;
  color: var(--accent); background: var(--accent-soft);
  border-color: color-mix(in srgb, var(--accent) 40%, transparent);
}
/* A long query truncates rather than pushing Clear all off the row. */
.af-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.af-x { margin-left: 6px; opacity: .7; }
.af-all { color: var(--text-dim); white-space: nowrap; }
```

- [ ] **Step 3: Wire it into `UnifiedList`**

In `src/components/UnifiedList.tsx`, add to the imports (beside the existing
`import FilterBar from "./FilterBar";`):

```tsx
import ActiveFilters from "./ActiveFilters";
import { activeFilters, type FilterKey } from "@/lib/activeFilters";
```

After the `projectSections` `useMemo` (currently ending at line 77) and before the
`dismiss` handler, add:

```tsx
  const filters = useMemo(
    () => activeFilters({ query, project, status, mine, sessionsOnly }),
    [query, project, status, mine, sessionsOnly],
  );

  const clearFilter = (key: FilterKey) => {
    switch (key) {
      case "query": setQuery(""); return;
      case "project": setProject(null); return;
      case "status": setStatus(null); return;
      case "mine": setMine(false); return;
      case "sessions": setSessionsOnly(false); return;
    }
  };

  const clearAllFilters = () => {
    setQuery("");
    setProject(null);
    setStatus(null);
    setMine(false);
    setSessionsOnly(false);
  };
```

Then mount the bar in the JSX, immediately after the `{!empty && (<FilterBar … />)}`
block and before `{noMatches && (…)}`:

```tsx
      {/* Guarded by !empty for the same reason FilterBar is: with no tickets and no
          sessions at all there is nothing for a filter to be hiding. */}
      {!empty && (
        <ActiveFilters filters={filters} onClear={clearFilter} onClearAll={clearAllFilters} />
      )}
```

- [ ] **Step 4: Typecheck and run the suite**

Run: `npx tsc --noEmit && npx vitest run`

Expected: `TypeScript: No errors found`, then **760 passing, 2 failing** — unchanged from
Task 1, since this task adds no tests (components are untested here by design).

- [ ] **Step 5: Verify in the running app**

Mojito is already running on port 8700 (`make prod`). It picks up source changes and
rebuilds, so wait for the rebuild, then open `http://localhost:8700/?token=<MOJITO_TOKEN>`
(the token is in `.env.local`) and check:

1. With no filters set, no bar appears.
2. Type `182` in the search box → a `Filtered` bar appears with one `182 ✕` chip and no
   `Clear all`.
3. Scroll the list down → the bar stays pinned at the top of the viewport.
4. Tap a project chip too → the bar now shows two chips and a `Clear all`.
5. Tap the `182 ✕` chip → only the query clears; the project chip stays active.
6. Tap `Clear all` → the bar disappears and the full list returns.

- [ ] **Step 6: Commit**

```bash
git add src/components/ActiveFilters.tsx src/components/UnifiedList.tsx src/app/globals.css
git commit -m "feat(filters): report active filters in a sticky bar"
```

---

### Task 3: Mine defaults OFF

**Files:**
- Modify: `src/components/UnifiedList.tsx:50-52`

**Interfaces:**
- Consumes: nothing new.
- Produces: no new exports. Changes the landing view to the whole board.

- [ ] **Step 1: Flip the default**

Replace these three lines in `src/components/UnifiedList.tsx`:

```tsx
  // Default on, as it was on the ticket list before the merge.
  const [mineRaw, setMineRaw] = usePersistedState("mojito-list-mine", "1");
  const mine = mineRaw !== "0";
```

with:

```tsx
  // Default off: the landing view is the whole board. With off as the baseline, "narrows
  // the list" and "deviates from the default" become the same thing, which is what lets
  // activeFilters treat Mine like every other filter instead of special-casing the one
  // that would otherwise put a chip in the sticky bar on every single visit.
  // `=== "1"` rather than `!== "0"`: with an off default, an unrecognised stored value
  // should read as off. usePersistedState only writes on change, so this default reaches
  // any browser that never touched the toggle, while one that did keeps its stored
  // choice — explicit beats default.
  const [mineRaw, setMineRaw] = usePersistedState("mojito-list-mine", "0");
  const mine = mineRaw === "1";
```

- [ ] **Step 2: Typecheck and run the suite**

Run: `npx tsc --noEmit && npx vitest run`

Expected: `TypeScript: No errors found`, then **760 passing, 2 failing**. No test pins the
old default, so nothing should break. If a test does fail, stop and report it rather than
editing the test to match.

- [ ] **Step 3: Verify in the running app**

In the browser, run `localStorage.removeItem("mojito-list-mine")` in the devtools console,
reload, and confirm the `Mine` chip is off and other people's tickets are listed. Then tap
`Mine` on and confirm it appears as a chip in the sticky bar from Task 2.

- [ ] **Step 4: Commit**

```bash
git add src/components/UnifiedList.tsx
git commit -m "feat(filters): default Mine off so the board is the landing view"
```

---

### Task 4: Launch feedback in `LaunchSheet`

The other half of the original report. `start()` runs a Linear fetch plus an asset
download before the server answers, and today the button neither disables nor says
anything for those seconds; a thrown `fetch` shows nothing at all.

**Files:**
- Create: `src/lib/apiError.ts`
- Test: `tests/lib/apiError.test.ts`
- Modify: `src/components/LaunchSheet.tsx` — one new state, three handlers, two button blocks

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `function apiError(res: Response, fallback: string): Promise<string>`.

- [ ] **Step 1: Write the failing test for `apiError`**

Create `tests/lib/apiError.test.ts`. `Response` is a global in Node 18+, so no import is
needed for it.

```ts
import { describe, it, expect } from "vitest";
import { apiError } from "@/lib/apiError";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });
}

describe("apiError", () => {
  it("returns the route's own error message", async () => {
    expect(await apiError(json({ error: "duplicate" }, 409), "launch failed"))
      .toBe("duplicate");
  });

  it("falls back to the status code when the body is not JSON", async () => {
    const res = new Response("<html>502 Bad Gateway</html>", { status: 502 });
    expect(await apiError(res, "launch failed")).toBe("launch failed (502)");
  });

  it("falls back when the JSON carries no error field", async () => {
    expect(await apiError(json({ id: "mojito-RIC-1-work" }, 422), "launch failed"))
      .toBe("launch failed (422)");
  });

  it("falls back on an empty body", async () => {
    expect(await apiError(new Response(null, { status: 500 }), "launch failed"))
      .toBe("launch failed (500)");
  });

  it("stringifies a non-string error field rather than rendering [object Object]", async () => {
    expect(await apiError(json({ error: 42 }, 400), "launch failed")).toBe("42");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/apiError.test.ts`

Expected: FAIL — `Failed to resolve import "@/lib/apiError"`.

- [ ] **Step 3: Write `apiError`**

Create `src/lib/apiError.ts`:

```ts
/**
 * The message to show for a failed API response: the route's own JSON `{ error }` when
 * there is one, else the caller's fallback with the status code.
 *
 * Every route in this app answers JSON, so a bare `res.text()` put a raw
 * `{"error":"duplicate"}` in front of the user. The fallback covers the bodies that are
 * not ours — a proxy's HTML error page, or nothing at all.
 */
export async function apiError(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    if (body?.error) return String(body.error);
  } catch { /* not JSON, or no body — fall through to the status code */ }
  return `${fallback} (${res.status})`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/apiError.test.ts`

Expected: PASS, 5 tests.

- [ ] **Step 5: Add the pending state and error handling to `LaunchSheet`**

In `src/components/LaunchSheet.tsx`, add to the imports:

```tsx
import { apiError } from "@/lib/apiError";
```

Above the component's `export default function LaunchSheet(`, add the module constant. The
three handlers below deliberately keep their own shape rather than collapsing into one
parameterised helper — `start()` alone does a DELETE first and special-cases 409, and a
wrapper carrying that as a callback reads worse than the repetition it removes. Only the
message is shared, so the one thing that would drift is the one thing hoisted:

```tsx
// Shared by all three launch handlers: the only part of their shape that would drift if
// copied. A thrown fetch is the case that used to show the user nothing at all.
const LAUNCH_FAILED = "launch request failed — check the connection and retry";
```

Beside the existing `verdictPending` state (line 30), add:

```tsx
  // One state for all three launch buttons, mirroring how a single verdictPending covers
  // the three verdict buttons. The ticket launch is the slow one: its POST runs a Linear
  // fetch and then downloads the ticket's assets before it answers, seconds during which
  // the button used to look dead.
  const [launching, setLaunching] = useState<"work" | "custom" | "shell" | null>(null);
  const launchBusy = launching !== null;
```

Replace `start()` (lines 99-112) with:

```tsx
  // Launch a claude session.
  const start = async () => {
    setErr(null);
    setLaunching("work");
    try {
      // A finished session for this ticket+status keeps the same tmux name, so clear it first
      // (kill + deregister) before relaunching, else the server rejects the launch as a duplicate.
      if (existing) await apiFetch(token, `/api/sessions/${existing.id}`, { method: "DELETE" });
      const res = await apiFetch(token, "/api/sessions", {
        method: "POST",
        body: JSON.stringify({ ticket: ticket.identifier, status: ticket.statusName, model, effort,
          projectName: ticket.project, title: ticket.title, labels: ticket.labels }),
      });
      if (res.status === 409) { setErr("A session for this ticket+status already exists."); return; }
      if (!res.ok) { setErr(await apiError(res, "launch failed")); return; }
      onLaunched();
      onClose();
    } catch {
      setErr(LAUNCH_FAILED);
    } finally {
      setLaunching(null);
    }
  };
```

Replace `startCustom()` (lines 116-125) with:

```tsx
  // Launch a bare, ticket-scoped custom session (RIC-128). Opens in the ticket's worktree if one
  // exists (else the repo root). Custom ids are random-suffixed, so no need to clear an existing one.
  const startCustom = async () => {
    setErr(null);
    setLaunching("custom");
    try {
      const res = await apiFetch(token, "/api/sessions", {
        method: "POST",
        body: JSON.stringify({ kind: "custom", ticket: ticket.identifier, status: ticket.statusName,
          projectName: ticket.project, title: ticket.title, labels: ticket.labels, model, effort }),
      });
      if (!res.ok) { setErr(await apiError(res, "launch failed")); return; }
      onLaunched();
      onClose();
    } catch {
      setErr(LAUNCH_FAILED);
    } finally {
      setLaunching(null);
    }
  };
```

Replace `startShell()` (lines 129-138) with:

```tsx
  // Launch a plain zsh terminal in the ticket's worktree (RIC-155). Like startCustom, shell ids
  // are random-suffixed, so there is no existing session to clear first.
  const startShell = async () => {
    setErr(null);
    setLaunching("shell");
    try {
      const res = await apiFetch(token, "/api/sessions", {
        method: "POST",
        body: JSON.stringify({ kind: "shell", ticket: ticket.identifier, status: ticket.statusName,
          projectName: ticket.project, title: ticket.title, labels: ticket.labels }),
      });
      if (!res.ok) { setErr(await apiError(res, "terminal failed")); return; }
      onLaunched();
      onClose();
    } catch {
      setErr(LAUNCH_FAILED);
    } finally {
      setLaunching(null);
    }
  };
```

- [ ] **Step 6: Make the buttons say what is happening**

Replace the `customBtn` block (lines 152-157) with:

```tsx
  // One tap per action: a bare Claude session or a plain terminal in the ticket's
  // worktree — direct, self-describing buttons instead of a mode toggle.
  const customBtn = (
    <div className="btns" style={{ marginTop: 12 }}>
      <button className="btn ghost" disabled={launchBusy} onClick={() => startCustom()}>
        {launching === "custom" ? "Starting…" : "Claude session"}
      </button>
      <button className="btn ghost" disabled={launchBusy} onClick={() => startShell()}>
        {launching === "shell" ? "Opening…" : "Terminal"}
      </button>
    </div>
  );
```

Replace the primary launch button (line 232) with:

```tsx
            <button className="btn primary block" disabled={launchBusy} onClick={() => start()}>
              {launching === "work" ? "Starting…" : existing ? "Start new session" : "Start session"}
            </button>
```

- [ ] **Step 7: Typecheck and run the whole suite**

Run: `npx tsc --noEmit && npx vitest run`

Expected: `TypeScript: No errors found`, then **765 passing, 2 failing**.

- [ ] **Step 8: Verify in the running app**

After the rebuild, open a ticket that has no session and tap `Start session`. Confirm the
button reads `Starting…` and is disabled for the seconds the request takes, that the three
launch buttons are all disabled meanwhile, and that the sheet closes with the session in
the list. Then confirm a failure surfaces: stop the server mid-request (or tap `Start
session` twice fast on the same ticket) and check the red error line reads a plain message
rather than raw JSON.

- [ ] **Step 9: Commit**

```bash
git add src/lib/apiError.ts tests/lib/apiError.test.ts src/components/LaunchSheet.tsx
git commit -m "fix(launch): report a launch in flight and surface its failures"
```

---

## Done when

- `npx tsc --noEmit && npx vitest run` reports **765 passing, 2 failing**, the 2 being the
  pre-existing `resolveDocPath` failures.
- A stale filter is visible from anywhere in the list, and one filter can be dropped
  without losing the others.
- Mine is off on a browser that never toggled it.
- `Start session` disables and reads `Starting…` while its request is in flight, and a
  failed launch shows a plain-language error.

## Deliberately not done here

- The two `resolveDocPath` failures (macOS `/var` symlink in the test fixture).
- `CLAUDE.md`'s claim that tests live under `tests/server/`; `tests/lib/` and
  `tests/client/` exist too. Both are separate one-line changes.
