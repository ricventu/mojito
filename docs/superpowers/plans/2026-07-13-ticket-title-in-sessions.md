# Ticket title in session cards and terminal page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the Linear ticket title on the session-list cards and on the individual session's terminal page.

**Architecture:** UI-only. `SessionMeta.title` already flows from the server through `useSessions` to both components, so this is JSX + CSS only in `SessionList.tsx` and `TerminalView.tsx` plus two new selectors in `globals.css`. Every title render is guarded on a truthy `title` because pre-schema sidecars may have it `undefined`.

**Tech Stack:** Next.js (App Router), React (client components), TypeScript, plain CSS (`globals.css`), vitest (server-side only).

## Global Constraints

- No server, API, sidecar, or `SessionMeta` type change — title is already carried.
- Every title render MUST be guarded on truthy `title` (old sidecars may have `title === undefined` despite the non-optional type).
- Do NOT reuse the existing `.card .title` class for the ticket title — it is used for the transient alert `message`. Use a new, distinct class.
- No new React test harness (none exists in the repo); the automated gate is `npm run typecheck` + `npm test`, plus manual verification.
- All identifiers, comments, and commit messages in English.

---

### Task 1: Ticket title on the session card

**Files:**
- Modify: `src/components/SessionList.tsx:24-25` (search filter) and `src/components/SessionList.tsx:70-71` (card JSX)
- Modify: `src/app/globals.css` (add `.card .session-title` after `:88`)

**Interfaces:**
- Consumes: `SessionMeta.title: string` (already defined, `src/server/types.ts:26`), available on each `s` in `SessionList`.
- Produces: nothing consumed by later tasks (Task 2 is independent).

- [ ] **Step 1: Add the title line to the card JSX**

In `src/components/SessionList.tsx`, between the id `row` div and the `status` div (currently `:70-71`), add the guarded title line. The block becomes:

```jsx
                  <div className="row">
                    <span className="id">{s.ticket}</span>
                    <span className="grow" />
                    <StateBadge state={s.state} />
                  </div>
                  {s.title && <div className="session-title">{s.title}</div>}
                  <div className="status">{s.launchStatus}</div>
                  {s.message && <div className="title">{s.message}</div>}
```

- [ ] **Step 2: Add `title` to the search filter**

In `src/components/SessionList.tsx`, extend the filter fields (currently `:24-25`):

```jsx
    return [s.ticket, s.launchStatus, s.model, s.message, s.title]
      .some((v) => v?.toLowerCase().includes(q));
```

- [ ] **Step 3: Add the CSS**

In `src/app/globals.css`, add after the `.card .title.muted` rule (`:88`):

```css
.card .session-title { margin-top: 4px; font: 600 14px/1.3 var(--mono); color: var(--text); }
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: exits 0, no errors.

- [ ] **Step 5: Run the test suite (regression check)**

Run: `npm test`
Expected: PASS (57 tests, 0 failures) — unchanged from baseline.

- [ ] **Step 6: Manual verification**

Run `npm run dev`, open the session list. Confirm a session launched with a ticket title shows the title on its own line under the identifier and above the status. Type part of a title into the filter and confirm the session matches. Confirm a session with no title (or an old sidecar) shows no empty title line.

- [ ] **Step 7: Commit**

```bash
git add src/components/SessionList.tsx src/app/globals.css
git commit -m "feat(mojito): show ticket title on session cards and filter by it (RIC-106)"
```

---

### Task 2: Ticket title on the terminal page

**Files:**
- Modify: `src/components/TerminalView.tsx:114` (insert after the closing `</header>`)
- Modify: `src/app/globals.css` (add `.term-title` after the `.term-head` rules, near `:186`)

**Interfaces:**
- Consumes: `session.title: string` (already on the `session` prop, type `SessionMeta`).
- Produces: nothing.

- [ ] **Step 1: Add the title line under the header**

In `src/components/TerminalView.tsx`, immediately after the closing `</header>` (`:114`), add the guarded title line. The region becomes:

```jsx
      </header>
      {session.title && <div className="term-title">{session.title}</div>}
      <div ref={holder} style={{ flex: 1, overflow: "hidden" }} />
```

- [ ] **Step 2: Add the CSS**

In `src/app/globals.css`, add after the `.term-head .status` rule (`:186`):

```css
.term-title { padding: 8px 14px; font: 600 14px/1.35 var(--mono); color: var(--text); border-bottom: 1px solid var(--border); }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exits 0, no errors.

- [ ] **Step 4: Run the test suite (regression check)**

Run: `npm test`
Expected: PASS (57 tests, 0 failures).

- [ ] **Step 5: Manual verification**

With `npm run dev` running, open a session's terminal page. Confirm the full ticket title shows on its own line directly below the header control row. Confirm a session with no title shows no empty title line.

- [ ] **Step 6: Commit**

```bash
git add src/components/TerminalView.tsx src/app/globals.css
git commit -m "feat(mojito): show ticket title on the terminal page (RIC-106)"
```

---

## Self-Review

**Spec coverage:**
- Session card title → Task 1, Steps 1 & 3. ✓
- Title in card search filter → Task 1, Step 2. ✓
- Terminal page title → Task 2, Steps 1 & 2. ✓
- Truthiness guard on both renders → Task 1 Step 1 (`s.title &&`), Task 2 Step 1 (`session.title &&`). ✓
- Distinct class (no `.title` collision) → `.session-title` (Task 1), `.term-title` (Task 2). ✓
- No server/data change → confirmed; no task touches server. ✓
- Testing via typecheck + suite + manual → both tasks. ✓

**Placeholder scan:** none — every code and command step is concrete.

**Type consistency:** `session-title` / `term-title` class names used consistently between JSX and CSS in each task; `s.title` / `session.title` match the `SessionMeta.title` field.
