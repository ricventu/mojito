# Toggle Auto-Advance on Started Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user turn a session's `autoAdvance` flag on or off after the session has already started, from both the session list and the terminal detail view.

**Architecture:** A thin server function `updateAutoAdvance` validates the flag, patches the in-memory `Registry` (which persists the sidecar JSON), and emits a `session.state` event so every connected client refetches. A new `PATCH` handler on the existing `/api/sessions/[id]` route calls it. Two UI toggles (SessionList card, TerminalView header) `PATCH` the endpoint.

**Tech Stack:** Next.js 15 (App Router, custom `server.ts`), React 19, TypeScript, Vitest, xterm.js. In-memory `Registry` singleton + `~/.mojito-state` sidecar JSON files (no DB). WebSocket event bus for live client refresh.

## Global Constraints

- All code artifacts in English (identifiers, comments, commit messages).
- `autoAdvance` is a per-session boolean on `SessionMeta` (`src/server/types.ts:17`). No global setting.
- The toggle changes the stored flag ONLY. It never launches or advances anything immediately. `decideAutoAdvance` reads the flag at the next stop-time.
- Server modules import sibling modules with the `.js` extension (e.g. `from "./registry.js"`), matching the existing codebase; client/`@/`-aliased imports do not.
- Route handlers stay thin; testable logic lives in a `src/server/*` module (mirrors the untested `advance` route vs. tested `hookHandler`).
- No React component test infrastructure exists — UI tasks are verified by `npm run typecheck` and manual driving, not unit tests.
- `apiFetch(token, path, init)` (`src/lib/client.ts`) already sets the token header and `Content-Type: application/json`; use it for all client calls.

---

### Task 1: `updateAutoAdvance` server function

**Files:**
- Create: `src/server/updateSession.ts`
- Test: `tests/server/updateSession.test.ts`

**Interfaces:**
- Consumes: `Registry` (`src/server/registry.js`), `EventBus` (`src/server/events.js`), `SessionMeta` (`src/server/types.js`).
- Produces: `updateAutoAdvance(id: string, autoAdvance: boolean, deps: { registry: Registry; bus: EventBus }): SessionMeta | null` — patches the session's `autoAdvance`, emits `{ type: "session.state", id, state }` with the session's current `state`, and returns the updated meta. Returns `null` when no session with `id` exists (and emits nothing).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { updateAutoAdvance } from "@/server/updateSession";
import { Registry } from "@/server/registry";
import { EventBus } from "@/server/events";
import type { SessionMeta } from "@/server/types";

let dir: string;
function seed(over: Partial<SessionMeta> = {}): Registry {
  const registry = new Registry(dir);
  const meta: SessionMeta = { id: "mojito-RIC-46-planned", ticket: "RIC-46", launchStatus: "Planned",
    model: "opus", effort: "high", autoAdvance: false, state: "running", cwd: "/x",
    createdAt: "2026-07-11T00:00:00.000Z", ...over };
  registry.upsert(meta);
  return registry;
}
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "mojito-")); });

describe("updateAutoAdvance", () => {
  it("flips the flag, persists it, and emits a state event", () => {
    const registry = seed({ autoAdvance: false });
    const bus = new EventBus();
    const events: unknown[] = [];
    bus.subscribe((e) => events.push(e));

    const result = updateAutoAdvance("mojito-RIC-46-planned", true, { registry, bus });

    expect(result?.autoAdvance).toBe(true);
    expect(registry.get("mojito-RIC-46-planned")?.autoAdvance).toBe(true);
    expect(events).toContainEqual({ type: "session.state", id: "mojito-RIC-46-planned", state: "running" });
  });

  it("can turn the flag off", () => {
    const registry = seed({ autoAdvance: true });
    const bus = new EventBus();
    const result = updateAutoAdvance("mojito-RIC-46-planned", false, { registry, bus });
    expect(result?.autoAdvance).toBe(false);
  });

  it("returns null and emits nothing for an unknown id", () => {
    const registry = seed();
    const bus = new EventBus();
    const events: unknown[] = [];
    bus.subscribe((e) => events.push(e));

    const result = updateAutoAdvance("nope", true, { registry, bus });

    expect(result).toBeNull();
    expect(events).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- updateSession`
Expected: FAIL — cannot resolve `@/server/updateSession` / `updateAutoAdvance is not a function`.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { Registry } from "./registry.js";
import type { EventBus } from "./events.js";
import type { SessionMeta } from "./types.js";

export function updateAutoAdvance(
  id: string,
  autoAdvance: boolean,
  deps: { registry: Registry; bus: EventBus },
): SessionMeta | null {
  const next = deps.registry.patch(id, { autoAdvance });
  if (!next) return null;
  deps.bus.emit({ type: "session.state", id, state: next.state });
  return next;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- updateSession`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/updateSession.ts tests/server/updateSession.test.ts
git commit -m "feat: add updateAutoAdvance server function"
```

---

### Task 2: `PATCH /api/sessions/[id]` route

**Files:**
- Modify: `src/app/api/sessions/[id]/route.ts` (add `PATCH` alongside existing `DELETE`)

**Interfaces:**
- Consumes: `updateAutoAdvance` (Task 1); `getConfig`, `getRegistry`, `getBus` from `@/server/app`; `tokenFromHeaders` from `@/server/auth`.
- Produces: `PATCH` handler. Body `{ autoAdvance: boolean }`. Responses: `401` unauthorized, `400` bad JSON or non-boolean `autoAdvance`, `404` unknown session, `200` with the updated `SessionMeta` JSON.

- [ ] **Step 1: Add the PATCH handler**

Add these imports at the top of the file (keep the existing ones):

```typescript
import { getBus } from "@/server/app";
import { updateAutoAdvance } from "@/server/updateSession";
```

Append the handler after the existing `DELETE` export:

```typescript
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const { id } = await params;
  let body;
  try { body = await req.json(); } catch { return new NextResponse("bad json", { status: 400 }); }
  if (typeof body?.autoAdvance !== "boolean") return new NextResponse("autoAdvance must be a boolean", { status: 400 });
  const next = updateAutoAdvance(id, body.autoAdvance, { registry: getRegistry(), bus: getBus() });
  if (!next) return new NextResponse("not found", { status: 404 });
  return NextResponse.json(next);
}
```

Note: `getConfig`, `getRegistry`, `NextResponse`, and `tokenFromHeaders` are already imported by the existing `DELETE` handler — do not duplicate those imports.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Verify the route end-to-end**

Start the dev server (`npm run dev`) with a running session present, then from another shell (substitute the real token and an existing session id):

```bash
curl -sS -X PATCH "http://localhost:3000/api/sessions/<SESSION_ID>" \
  -H "x-mojito-token: <TOKEN>" -H "Content-Type: application/json" \
  -d '{"autoAdvance": true}'
```

Expected: `200` with JSON where `"autoAdvance": true`. Then confirm error paths:
- `-d '{}'` → `400 autoAdvance must be a boolean`.
- `PATCH` on a bogus id → `404 not found`.
- Omit the token header → `401 unauthorized`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/sessions/[id]/route.ts
git commit -m "feat: PATCH /api/sessions/[id] to toggle auto-advance"
```

---

### Task 3: Auto-advance toggle chip style

**Files:**
- Modify: `src/app/globals.css` (after the `.chip` rule at line 106-110)

**Interfaces:**
- Produces: a `<button class="chip toggle">` visual: resets native button styling to match the existing `.chip` span, adds a pressed/on variant class `.chip.on`. Used by Tasks 4 and 5.

- [ ] **Step 1: Add the toggle chip styles**

Insert directly after the closing brace of the `.chip` rule (line 110):

```css
button.chip {
  cursor: pointer; -webkit-appearance: none; appearance: none;
  font: 600 11px/1 var(--mono);
}
button.chip:active { transform: scale(.96); }
.chip.on { color: var(--run); border-color: color-mix(in srgb, var(--run) 40%, transparent); }
```

- [ ] **Step 2: Verify the CSS loads**

Run: `npm run dev` and load the app; confirm no console/build error from the stylesheet. (Visual confirmation happens in Tasks 4-5.)

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "style: interactive chip toggle variant"
```

---

### Task 4: Auto-advance toggle on the session card

**Files:**
- Modify: `src/components/SessionList.tsx`

**Interfaces:**
- Consumes: `apiFetch` (already imported), the `PATCH` route (Task 2), the `.chip.on` style (Task 3), the existing `onChanged` prop.
- Produces: a tappable `auto: on` / `auto: off` chip inside each card's `.meta` row that toggles the session's flag without opening the session.

- [ ] **Step 1: Add the toggle handler**

Inside the `SessionList` component body, next to the existing `dismiss` function, add:

```tsx
const toggleAuto = async (e: React.MouseEvent, s: SessionMeta) => {
  e.stopPropagation();
  await apiFetch(token, `/api/sessions/${s.id}`, { method: "PATCH", body: JSON.stringify({ autoAdvance: !s.autoAdvance }) });
  onChanged();
};
```

- [ ] **Step 2: Replace the static badge with the toggle**

In the `.meta` div, replace this line:

```tsx
{s.autoAdvance && <span className="chip">auto</span>}
```

with:

```tsx
<button className={`chip toggle${s.autoAdvance ? " on" : ""}`} onClick={(e) => toggleAuto(e, s)}>
  auto: {s.autoAdvance ? "on" : "off"}
</button>
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Verify in the app**

Run `npm run dev`, open the Sessions tab. For a session card:
- The chip reads `auto: off` (or `auto: on` if launched with auto-advance).
- Tapping the chip flips the label and does NOT open the terminal view.
- Reloading the page keeps the new value (persisted to the sidecar).

- [ ] **Step 5: Commit**

```bash
git add src/components/SessionList.tsx
git commit -m "feat: toggle auto-advance from the session card"
```

---

### Task 5: Auto-advance toggle in the terminal view

**Files:**
- Modify: `src/components/TerminalView.tsx`

**Interfaces:**
- Consumes: `apiFetch` (already imported), the `PATCH` route (Task 2), the `.chip.on` style (Task 3), the `session` prop.
- Produces: an `auto: on` / `auto: off` chip in the header that toggles the flag, backed by local optimistic state (the `session` prop is a snapshot and is not re-threaded by `page.tsx`).

- [ ] **Step 1: Add local state and handler**

Add the state next to the existing `advErr` state:

```tsx
const [auto, setAuto] = useState(session.autoAdvance);
```

Add the handler next to the existing `advance` function:

```tsx
const toggleAuto = async () => {
  const nextValue = !auto;
  const res = await apiFetch(token, `/api/sessions/${session.id}`, { method: "PATCH", body: JSON.stringify({ autoAdvance: nextValue }) });
  if (res.ok) setAuto(nextValue);
};
```

- [ ] **Step 2: Add the toggle to the header**

Replace the header content:

```tsx
<header style={{ padding: 12, borderBottom: "1px solid #222" }}>
  <button onClick={onBack}>‹</button> {session.ticket} · {session.launchStatus}
</header>
```

with:

```tsx
<header style={{ display: "flex", alignItems: "center", gap: 8, padding: 12, borderBottom: "1px solid #222" }}>
  <button onClick={onBack}>‹</button>
  <span>{session.ticket} · {session.launchStatus}</span>
  <span style={{ flex: 1 }} />
  <button className={`chip toggle${auto ? " on" : ""}`} onClick={toggleAuto}>
    auto: {auto ? "on" : "off"}
  </button>
</header>
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Verify in the app**

Run `npm run dev`, open a session's terminal. Confirm:
- The header shows `auto: on`/`auto: off` matching the session's flag.
- Tapping flips the label immediately.
- Going back to the Sessions tab shows the card chip in the matching state (both read the same persisted flag).

- [ ] **Step 5: Commit**

```bash
git add src/components/TerminalView.tsx
git commit -m "feat: toggle auto-advance from the terminal view"
```

---

### Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: all tests pass, including the new `updateSession` tests.

- [ ] **Step 2: Typecheck the whole project**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: End-to-end behavior check**

With `npm run dev` running and at least one active session:
1. Launch a ticket with auto-advance OFF. Confirm the card chip reads `auto: off`.
2. Toggle it ON from the card; open the terminal — header reads `auto: on`.
3. Toggle it OFF from the terminal header; return to the list — card reads `auto: off`.
4. Confirm no stage was launched merely by toggling (the session state is unchanged in the list).
