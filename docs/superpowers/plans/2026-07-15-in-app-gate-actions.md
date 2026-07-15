# In-App Gate Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user resolve the To QA verdict (approve/reject) and pick the To Merge mode (local/mr) in Mojito's LaunchSheet *before* any session launches, eliminating the post-launch `TerminalView` gate and the claude session spawned just to reach it.

**Architecture:** A new pure `resolveTicketVerdict` orchestrator (tested) backs a thin ticket-keyed verdict route; To QA resolves as a pure Linear mutation with no session. To Merge launches one claude session with the mode passed as `trailingArg` (now forwarded by `POST /api/sessions`). `TerminalView`'s gate UI and the now-orphaned `advance` route are deleted.

**Tech Stack:** Next.js (App Router, route handlers), TypeScript, React, Vitest.

## Global Constraints

- All code artifacts in English (identifiers, comments, commit messages).
- Test gate: `npx tsc --noEmit && npx vitest run` must pass.
- No lime change; no `qaVerdict.ts` / `linear.ts` change.
- `GATE_STATES`, `STAGE_OF`, `decideAutoAdvance` in `autoAdvance.ts` stay unchanged.
- Server logic lives under `src/server/` with tests under `tests/server/`; route handlers and React components are thin glue (untested), matching the existing repo convention.

---

### Task 1: `resolveTicketVerdict` orchestration (To QA)

**Files:**
- Create: `src/server/ticketVerdict.ts`
- Test: `tests/server/ticketVerdict.test.ts`

**Interfaces:**
- Consumes: `QaArg`, `QaVerdictError` from `@/server/qaVerdict`.
- Produces:
  - `type VerdictResult = { ok: true; arg: QaArg } | { ok: false; code: 400 | 409 | 422; error: string }`
  - `interface TicketVerdictDeps { getIssueStatus: (ticket: string) => Promise<string>; resolveVerdict: (input: { ticket: string; arg: QaArg; reason?: string }) => Promise<void>; supersedeStaleSession: (ticket: string) => Promise<void> }`
  - `resolveTicketVerdict(input: { ticket: string; arg: string; reason?: string }, deps: TicketVerdictDeps): Promise<VerdictResult>`

- [ ] **Step 1: Write the failing test**

Create `tests/server/ticketVerdict.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { resolveTicketVerdict } from "@/server/ticketVerdict";
import { QaVerdictError } from "@/server/qaVerdict";

function deps(over: Record<string, unknown> = {}) {
  return {
    getIssueStatus: vi.fn(async () => "To QA"),
    resolveVerdict: vi.fn(async () => {}),
    supersedeStaleSession: vi.fn(async () => {}),
    ...over,
  };
}

describe("resolveTicketVerdict", () => {
  it("approve at To QA resolves the verdict then supersedes the stale session", async () => {
    const d = deps();
    const res = await resolveTicketVerdict({ ticket: "RIC-110", arg: "approve" }, d);
    expect(res).toEqual({ ok: true, arg: "approve" });
    expect(d.resolveVerdict).toHaveBeenCalledWith({ ticket: "RIC-110", arg: "approve", reason: undefined });
    expect(d.supersedeStaleSession).toHaveBeenCalledWith("RIC-110");
  });

  it("reject passes the reason through", async () => {
    const d = deps();
    const res = await resolveTicketVerdict({ ticket: "RIC-110", arg: "reject", reason: "broken" }, d);
    expect(res).toEqual({ ok: true, arg: "reject" });
    expect(d.resolveVerdict).toHaveBeenCalledWith({ ticket: "RIC-110", arg: "reject", reason: "broken" });
  });

  it("returns 409 and touches nothing when the ticket is not at To QA", async () => {
    const d = deps({ getIssueStatus: vi.fn(async () => "To Code") });
    const res = await resolveTicketVerdict({ ticket: "RIC-110", arg: "approve" }, d);
    expect(res).toEqual({ ok: false, code: 409, error: "ticket is not at To QA" });
    expect(d.resolveVerdict).not.toHaveBeenCalled();
    expect(d.supersedeStaleSession).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid arg without checking status", async () => {
    const d = deps();
    const res = await resolveTicketVerdict({ ticket: "RIC-110", arg: "nope" }, d);
    expect(res).toEqual({ ok: false, code: 400, error: "invalid arg" });
    expect(d.getIssueStatus).not.toHaveBeenCalled();
  });

  it("maps QaVerdictError to 400 and skips supersede", async () => {
    const d = deps({ resolveVerdict: vi.fn(async () => { throw new QaVerdictError("rejection reason required"); }) });
    const res = await resolveTicketVerdict({ ticket: "RIC-110", arg: "reject", reason: "" }, d);
    expect(res).toEqual({ ok: false, code: 400, error: "rejection reason required" });
    expect(d.supersedeStaleSession).not.toHaveBeenCalled();
  });

  it("maps a generic error to 422 and skips supersede", async () => {
    const d = deps({ resolveVerdict: vi.fn(async () => { throw new Error("Linear down"); }) });
    const res = await resolveTicketVerdict({ ticket: "RIC-110", arg: "approve" }, d);
    expect(res).toEqual({ ok: false, code: 422, error: "Linear down" });
    expect(d.supersedeStaleSession).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/ticketVerdict.test.ts`
Expected: FAIL — cannot resolve `@/server/ticketVerdict`.

- [ ] **Step 3: Write minimal implementation**

Create `src/server/ticketVerdict.ts`:

```typescript
import { QaVerdictError, type QaArg } from "./qaVerdict.js";

export type VerdictResult =
  | { ok: true; arg: QaArg }
  | { ok: false; code: 400 | 409 | 422; error: string };

export interface TicketVerdictDeps {
  getIssueStatus: (ticket: string) => Promise<string>;
  resolveVerdict: (input: { ticket: string; arg: QaArg; reason?: string }) => Promise<void>;
  supersedeStaleSession: (ticket: string) => Promise<void>;
}

/**
 * Resolve a To QA verdict keyed by ticket (no session required). Validates the arg and the
 * live status, delegates the Linear mutation to resolveVerdict, then retires any stale gate
 * session. On any failure the stale-session cleanup is skipped so the caller can retry.
 */
export async function resolveTicketVerdict(
  input: { ticket: string; arg: string; reason?: string },
  deps: TicketVerdictDeps,
): Promise<VerdictResult> {
  const { ticket, arg, reason } = input;
  if (arg !== "approve" && arg !== "reject") return { ok: false, code: 400, error: "invalid arg" };

  const status = await deps.getIssueStatus(ticket);
  if (status !== "To QA") return { ok: false, code: 409, error: "ticket is not at To QA" };

  try {
    await deps.resolveVerdict({ ticket, arg, reason });
  } catch (e) {
    const error = e instanceof Error ? e.message : "verdict failed";
    return { ok: false, code: e instanceof QaVerdictError ? 400 : 422, error };
  }

  await deps.supersedeStaleSession(ticket);
  return { ok: true, arg };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/ticketVerdict.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/ticketVerdict.ts tests/server/ticketVerdict.test.ts
git commit -m "feat(mojito): add resolveTicketVerdict orchestration (RIC-110)"
```

---

### Task 2: Ticket-keyed verdict route

**Files:**
- Create: `src/app/api/tickets/[id]/verdict/route.ts`

**Interfaces:**
- Consumes: `resolveTicketVerdict`, `TicketVerdictDeps` (Task 1); `resolveQaVerdict` from `@/server/qaVerdict`; `getIssueStatus`, `setIssueStatus`, `postComment` from `@/server/linear`; `tmuxName` from `@/server/sessionKey`; `validateTicket` from `@/server/sessionKey`; `supersedeSession` from `@/server/supersede`; `closeSession` from `@/server/tmux`.
- Produces: `POST /api/tickets/<identifier>/verdict` accepting `{ arg, reason? }`.

- [ ] **Step 1: Write the route**

Create `src/app/api/tickets/[id]/verdict/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getConfig, getRegistry } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { getIssueStatus, setIssueStatus, postComment } from "@/server/linear";
import { resolveQaVerdict } from "@/server/qaVerdict";
import { resolveTicketVerdict } from "@/server/ticketVerdict";
import { tmuxName, validateTicket } from "@/server/sessionKey";
import { supersedeSession } from "@/server/supersede";
import { closeSession } from "@/server/tmux";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const { id } = await params;
  try { validateTicket(id); } catch { return new NextResponse("invalid ticket", { status: 400 }); }
  let body;
  try { body = await req.json(); } catch { return new NextResponse("bad json", { status: 400 }); }
  const { arg, reason } = body;

  const result = await resolveTicketVerdict(
    { ticket: id, arg, reason },
    {
      getIssueStatus: (t) => getIssueStatus(cfg.linearApiKey, t),
      resolveVerdict: (i) =>
        resolveQaVerdict(i, {
          setIssueStatus: (t, s) => setIssueStatus(cfg.linearApiKey, t, s),
          postComment: (t, b) => postComment(cfg.linearApiKey, t, b),
        }),
      supersedeStaleSession: async (t) => {
        const registry = getRegistry();
        const sid = tmuxName(t, "To QA");
        if (registry.get(sid)) await supersedeSession(sid, { closeSession, registry });
      },
    },
  );

  if (result.ok) return NextResponse.json({ ok: true, arg: result.arg }, { status: 200 });
  return NextResponse.json({ error: result.error }, { status: result.code });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/tickets/[id]/verdict/route.ts
git commit -m "feat(mojito): add ticket-keyed To QA verdict route (RIC-110)"
```

---

### Task 3: Forward `trailingArg` through `POST /api/sessions`

**Files:**
- Modify: `src/app/api/sessions/route.ts:18-24`
- Test: `tests/server/launch.test.ts` (add a case)

**Interfaces:**
- Consumes: `launchSession` / `LaunchRequest.trailingArg` (already exists in `src/server/launch.ts`).
- Produces: `POST /api/sessions` accepts an optional `trailingArg: "local" | "mr"`.

- [ ] **Step 1: Add the failing test for the To Merge command shape**

In `tests/server/launch.test.ts`, add inside the `describe("launchSession", ...)` block, after the existing `"appends a trailing gate arg…"` test:

```typescript
  it("appends the To Merge mode as the trailing gate arg", () => {
    expect(buildClaudeCommand({ ...baseReq, trailingArg: "local" }, "/s/x.json"))
      .toContain("'/lime-next RIC-46 local'");
    expect(buildClaudeCommand({ ...baseReq, trailingArg: "mr" }, "/s/x.json"))
      .toContain("'/lime-next RIC-46 mr'");
  });
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run tests/server/launch.test.ts`
Expected: PASS — `buildClaudeCommand` already appends `trailingArg`; this pins the To Merge shape.

- [ ] **Step 3: Forward and validate `trailingArg` in the route**

In `src/app/api/sessions/route.ts`, replace the `POST` body (lines 13-30) with:

```typescript
export async function POST(req: Request) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  let body;
  try { body = await req.json(); } catch { return new NextResponse("bad json", { status: 400 }); }
  // Only the To Merge gate passes a trailing arg (the Stage-5 mode); whitelist it so the
  // launch command can never carry an arbitrary token.
  if (body.trailingArg !== undefined && body.trailingArg !== "local" && body.trailingArg !== "mr") {
    return NextResponse.json({ error: "invalid trailingArg" }, { status: 400 });
  }
  const res = await launchSession(
    { ticket: body.ticket, status: body.status, model: body.model ?? "opus", effort: body.effort ?? "high",
      autoAdvance: !!body.autoAdvance, projectName: body.projectName ?? null,
      title: body.title ?? "", labels: Array.isArray(body.labels) ? body.labels : [],
      trailingArg: body.trailingArg },
    { registry: getRegistry(), stateDir: cfg.stateDir, port: cfg.port, token: cfg.token, projectsPath: cfg.projectsPath,
      hasSession, newSession, pipePane },
  );
  if (!res.ok) {
    const status = res.reason === "duplicate" ? 409 : 422;
    return NextResponse.json({ error: res.reason, id: res.id }, { status });
  }
  return NextResponse.json(res.meta, { status: 201 });
}
```

- [ ] **Step 4: Typecheck and test**

Run: `npx tsc --noEmit && npx vitest run tests/server/launch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/sessions/route.ts tests/server/launch.test.ts
git commit -m "feat(mojito): forward whitelisted trailingArg through POST /api/sessions (RIC-110)"
```

---

### Task 4: `QaVerdictButtons` component

**Files:**
- Create: `src/components/QaVerdictButtons.tsx`

**Interfaces:**
- Produces: `export default function QaVerdictButtons({ onApprove, onReject }: { onApprove: () => void; onReject: (reason: string) => void })`.

- [ ] **Step 1: Write the component**

Create `src/components/QaVerdictButtons.tsx` (the approve / reject-with-inline-reason UI, owning its own state):

```tsx
"use client";
import { useState } from "react";

export default function QaVerdictButtons(
  { onApprove, onReject }: { onApprove: () => void; onReject: (reason: string) => void },
) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <div className="btns">
      <button className="btn primary" onClick={onApprove}>approve</button>
      {rejecting ? (
        <>
          <textarea
            className="reason"
            placeholder="Rejection reason…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <button className="btn danger" disabled={!reason.trim()} onClick={() => onReject(reason)}>
            confirm reject
          </button>
        </>
      ) : (
        <button className="btn danger" onClick={() => setRejecting(true)}>reject</button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/QaVerdictButtons.tsx
git commit -m "feat(mojito): extract QaVerdictButtons component (RIC-110)"
```

---

### Task 5: Branch `LaunchSheet` on gate status

**Files:**
- Modify: `src/components/LaunchSheet.tsx`

**Interfaces:**
- Consumes: `QaVerdictButtons` (Task 4); `POST /api/tickets/<id>/verdict` (Task 2); `POST /api/sessions` with `trailingArg` (Task 3).

- [ ] **Step 1: Rewrite `LaunchSheet`**

Replace the entire contents of `src/components/LaunchSheet.tsx` with:

```tsx
"use client";
import { useState } from "react";
import { apiFetch } from "@/lib/client";
import { tmuxName } from "@/server/sessionKey";
import StateBadge from "./StateBadge";
import QaVerdictButtons from "./QaVerdictButtons";
import type { SessionMeta, TicketSummary } from "@/server/types";

const MODELS = ["opus", "sonnet", "fable"];
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

export default function LaunchSheet(
  { token, ticket, sessions, onClose, onLaunched, onOpen }:
  { token: string; ticket: TicketSummary; sessions: SessionMeta[]; onClose: () => void;
    onLaunched: () => void; onOpen: (s: SessionMeta) => void },
) {
  const [model, setModel] = useState("opus");
  const [effort, setEffort] = useState("high");
  const [auto, setAuto] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const existingId = tmuxName(ticket.identifier, ticket.statusName);
  const existing = sessions.find((s) => s.id === existingId);
  const existingActive = existing != null
    && (existing.state === "running" || existing.state === "needs-input" || existing.state === "starting");

  // To QA is resolved as a pure Linear mutation — no session is ever launched.
  const submitVerdict = async (arg: "approve" | "reject", reason?: string) => {
    const res = await apiFetch(token, `/api/tickets/${ticket.identifier}/verdict`, {
      method: "POST",
      body: JSON.stringify(reason === undefined ? { arg } : { arg, reason }),
    });
    if (res.ok) { onLaunched(); onClose(); return; }
    let message = `verdict failed (${res.status})`;
    try { const b = await res.json(); if (b?.error) message = b.error; } catch { /* non-JSON */ }
    setErr(message);
  };

  // Launch a claude session. trailingArg carries the To Merge mode (local|mr) when present.
  const start = async (trailingArg?: "local" | "mr") => {
    // A finished session for this ticket+status keeps the same tmux name, so clear it first
    // (kill + deregister) before relaunching, else the server rejects the launch as a duplicate.
    if (existing) await apiFetch(token, `/api/sessions/${existing.id}`, { method: "DELETE" });
    const res = await apiFetch(token, "/api/sessions", {
      method: "POST",
      body: JSON.stringify({ ticket: ticket.identifier, status: ticket.statusName, model, effort,
        autoAdvance: auto, projectName: ticket.project, title: ticket.title, labels: ticket.labels,
        ...(trailingArg ? { trailingArg } : {}) }),
    });
    if (res.status === 409) { setErr("A session for this ticket+status already exists."); return; }
    if (!res.ok) { setErr(await res.text()); return; }
    onLaunched();
    onClose();
  };

  const isToQa = ticket.statusName === "To QA";
  const isToMerge = ticket.statusName === "To Merge";

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3><span className="id" style={{ fontSize: 16 }}>{ticket.identifier}</span> <span className="chip">{ticket.statusName}</span></h3>
        {isToQa ? (
          <QaVerdictButtons onApprove={() => submitVerdict("approve")} onReject={(reason) => submitVerdict("reject", reason)} />
        ) : existingActive ? (
          <button className="btn primary block" onClick={() => onOpen(existing!)}>Open running session</button>
        ) : (
          <>
            {existing && (
              <button className="btn ghost block" style={{ marginBottom: 12 }} onClick={() => onOpen(existing)}>
                Open session (<StateBadge state={existing.state} />)
              </button>
            )}
            <div className="two">
              <label className="field"><span className="lbl">Model</span>
                <select value={model} onChange={(e) => setModel(e.target.value)}>{MODELS.map((m) => <option key={m}>{m}</option>)}</select></label>
              <label className="field"><span className="lbl">Effort</span>
                <select value={effort} onChange={(e) => setEffort(e.target.value)}>{EFFORTS.map((x) => <option key={x}>{x}</option>)}</select></label>
            </div>
            <label className="toggle" style={{ marginBottom: 12 }}>
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-advance
            </label>
            {isToMerge ? (
              <div className="btns">
                <button className="btn primary" onClick={() => start("local")}>Start · local</button>
                <button className="btn primary" onClick={() => start("mr")}>Start · mr</button>
              </div>
            ) : (
              <button className="btn primary block" onClick={() => start()}>{existing ? "Start new session" : "Start session"}</button>
            )}
          </>
        )}
        {err && <p className="err-text">{err}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/LaunchSheet.tsx
git commit -m "feat(mojito): resolve To QA verdict and pick To Merge mode in LaunchSheet (RIC-110)"
```

---

### Task 6: Strip `TerminalView` gate + delete the `advance` route

**Files:**
- Modify: `src/components/TerminalView.tsx`
- Delete: `src/app/api/sessions/[id]/advance/route.ts` (and its now-empty `advance/` dir)

**Interfaces:**
- Consumes: nothing new. Removes the last caller of `POST /api/sessions/[id]/advance`.

- [ ] **Step 1: Delete the advance route**

```bash
git rm src/app/api/sessions/[id]/advance/route.ts
```

- [ ] **Step 2: Remove gate state and helpers from `TerminalView`**

In `src/components/TerminalView.tsx`:

Remove the `GATE_STATES` import (line 9):

```tsx
import { GATE_STATES } from "@/server/autoAdvance";
```

Remove the three gate-related `useState` declarations (lines 18, 20-21):

```tsx
  const [advErr, setAdvErr] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
```

Remove the `isGate` const and the entire `advance` function (lines 99-118):

```tsx
  const isGate = GATE_STATES.includes(session.launchStatus);
  const advance = async (arg: string, reason?: string) => {
    const res = await apiFetch(token, `/api/sessions/${session.id}/advance`, {
      method: "POST",
      body: JSON.stringify(reason === undefined ? { arg } : { arg, reason }),
    });
    if (res.ok) {
      setAdvErr(null);
      onBack();
    } else {
      let message = `advance failed (${res.status})`;
      try {
        const body = await res.json();
        if (body?.error) message = body.error;
      } catch {
        /* non-JSON error body */
      }
      setAdvErr(message);
    }
  };
```

- [ ] **Step 3: Replace the gate block with the AccessoryBar**

In `src/components/TerminalView.tsx`, replace the entire `{isGate ? ( … ) : ( <AccessoryBar onSend={send} /> )}` block (lines 151-187) with just:

```tsx
      <AccessoryBar onSend={send} />
```

Verify no `apiFetch` usage is left orphaned — it is still used by `toggleAuto` and `kill`, so keep the `apiFetch` import.

- [ ] **Step 4: Typecheck (catches any dangling reference)**

Run: `npx tsc --noEmit`
Expected: PASS. If it flags an unused import or a leftover reference to `advance` / `isGate` / `advErr` / `rejecting` / `reason`, remove it.

- [ ] **Step 5: Full test gate**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS (all suites, including the new `ticketVerdict` tests). The tmux integration test is skipped when `tmux` is unavailable.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(mojito): remove TerminalView gate and dead advance route (RIC-110)"
```

---

## Self-Review notes

- **Spec coverage:** verdict orchestration (Task 1) + route (Task 2); `trailingArg` forwarding (Task 3); `QaVerdictButtons` extraction (Task 4); LaunchSheet To QA + To Merge branches (Task 5); TerminalView strip + advance-route deletion (Task 6). All spec sections mapped.
- **Type consistency:** `resolveTicketVerdict`, `VerdictResult`, `TicketVerdictDeps` names identical across Tasks 1–2; `submitVerdict` / `start(trailingArg)` signatures consistent across Task 5; `trailingArg` values `"local" | "mr"` consistent across Tasks 3 and 5.
- **Manual verification (after Task 6):** run the app, tap a To QA ticket → approve moves it to To Merge with no session; reject requires a reason, comments, and moves to To Code. Tap a To Merge ticket → `Start · local` / `Start · mr` launches exactly one session whose command ends `/lime-next <TICKET> local|mr`.
```
