# Move "New ticket" onto the filter row — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the `+ New ticket` button off its own row and onto the ticket search-filter row (right-aligned), with a zero-tickets empty state so the first ticket stays creatable.

**Architecture:** UI-only change in one React client component, `src/components/TicketList.tsx`. Reuse `FilterBar`'s existing `action` slot (already used by the Sessions tab) to render the button on the search row; add a zero-tickets empty state mirroring `SessionList`. No CSS, server, API, or data change.

**Tech Stack:** Next.js + TypeScript + React (client component). Tests: `npx tsc --noEmit` + `npx vitest run` (vitest, `environment: "node"`).

## Global Constraints

- Change only `src/components/TicketList.tsx`. No CSS, server, API, `FilterBar`, or `SessionList` change.
- Keep the button style `btn primary sm` on the filter row and `btn primary block` in the empty state.
- All code artifacts in English.
- Keep `npx tsc --noEmit` and `npx vitest run` green.
- No React component test harness exists (vitest is `environment: "node"`, `tests/**/*.test.ts` only). Do NOT add one. Verification for this presentational change is typecheck + existing suite + visual check in the running app.

---

### Task 1: Relocate "New ticket" to the filter row + add empty state

**Files:**
- Modify: `src/components/TicketList.tsx` (the `return (...)` block, currently lines 49–102)

**Interfaces:**
- Consumes: `FilterBar`'s existing `action?: React.ReactNode` prop (`src/components/FilterBar.tsx:6,17,31`), rendered after the search input inside `.filter-top`. No signature change.
- Consumes: existing local state `newOpen` / `setNewOpen` and the `NewTicketSheet` rendered at the bottom of the component. Unchanged.
- Produces: nothing consumed by other tasks (single-task plan).

This is one atomic edit: the button relocation and the empty state are interdependent (moving the button inside `FilterBar` hides it when `tickets.length === 0`, so the empty state must land in the same change to avoid a regression at the commit boundary). There is no red-green TDD cycle here — there is no component test harness — so the guard is typecheck + existing suite + visual verification.

- [ ] **Step 1: Edit the `return` block of `src/components/TicketList.tsx`**

Replace the current dedicated button row + `FilterBar` usage. Specifically:

Remove this block (currently lines 51–54):

```jsx
      <div className="row" style={{ marginBottom: 12 }}>
        <span className="grow" />
        <button className="btn primary sm" onClick={() => setNewOpen(true)}>+ New ticket</button>
      </div>
```

So the top of the returned JSX becomes exactly:

```jsx
  return (
    <div className="pad">
      {tickets.length === 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p className="empty">No tickets.</p>
          <button className="btn primary block" onClick={() => setNewOpen(true)}>+ New ticket</button>
        </div>
      )}
      {tickets.length > 0 && (
        <FilterBar
          query={query} onQuery={setQuery}
          projects={projects} active={project} onProject={setProject}
          statuses={statuses} activeStatus={status} onStatus={setStatus}
          placeholder="Filter tickets…"
          action={
            <button className="btn primary sm" onClick={() => setNewOpen(true)}>+ New ticket</button>
          }
        />
      )}
      {tickets.length > 0 && filtered.length === 0 && <p className="empty">No matching tickets.</p>}
```

Leave everything from the `{Object.entries(groups).map(...)}` block onward (the groups render, `LaunchSheet`, and `NewTicketSheet`) exactly as-is.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (exit 0).

- [ ] **Step 3: Run the existing test suite**

Run: `npx vitest run`
Expected: PASS — the suite is unchanged and does not touch `TicketList`; it must stay green (the tmux integration test may be skipped if `tmux` is unavailable).

- [ ] **Step 4: Visual verification in the running app**

Start the app (dev server) and open the Tickets tab. Confirm:
- With tickets present: `+ New ticket` sits on the same row as the search input, right-aligned; the old dedicated row above the filter is gone; clicking it opens the New ticket sheet.
- With no tickets: "No tickets." plus a full-width `+ New ticket` button show; clicking it opens the New ticket sheet.
- Filtering to zero results still shows the filter row (button reachable) and "No matching tickets."

Note: the app runs on `:8700` and the main checkout shares `.next` — do not start a build/server in the main checkout while the live dev server is up. Verify against a dev instance for this worktree (or the existing live instance once merged).

- [ ] **Step 5: Commit**

```bash
git add src/components/TicketList.tsx
git commit -m "feat(mojito): move New ticket onto the filter row (RIC-132)"
```

## Self-Review

**1. Spec coverage:**
- Spec §1 "Remove the dedicated button row" → Step 1 removes lines 51–54. ✓
- Spec §2 "Pass the button through FilterBar's `action` slot" (kept `btn primary sm`) → Step 1 adds the `action` prop. ✓
- Spec §3 "Preserve New ticket when zero tickets" (`btn primary block`, mirror Sessions) → Step 1 adds the empty state. ✓
- Spec "Testing" (no harness; typecheck + suite + visual) → Steps 2–4. ✓
- Spec "Out of scope" (no CSS/server/FilterBar change, keep `primary`) → Global Constraints. ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/vague steps — every code step shows the exact JSX. ✓

**3. Type consistency:** No new types or signatures introduced; reuses `FilterBar`'s existing `action?: React.ReactNode` and existing `setNewOpen`. ✓
