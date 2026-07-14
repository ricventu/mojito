# Mojito In-App To QA Verdict — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the To QA approve/reject verdict directly in Mojito (Linear mutation), without launching a claude/lime session.

**Architecture:** Add Linear write helpers (`setIssueStatus`, `postComment`) to the existing raw-GraphQL `linear.ts`. A pure `qaVerdict.ts` orchestrates approve (→ To Merge) and reject (comment + → To Code). The `advance` route branches: To QA + approve/reject → resolve in-process + retire the gate session; everything else keeps the current `launchSession` path. `TerminalView` gets an inline reason field for reject.

**Tech Stack:** Next.js (app router) + TypeScript, Vitest, raw Linear GraphQL over `fetch`.

## Global Constraints

- All code artifacts in English (identifiers, comments, commits).
- Tests: `npx tsc --noEmit && npx vitest run` must pass. Server logic under `src/server/`, tests under `tests/server/`.
- Linear access uses raw GraphQL via the module's `query<T>()` helper with an injectable `fetchImpl` (default `fetch`) — mirror the existing `listOpenIssues` / `getIssueStatus` style.
- No lime change; `STAGE_OF` / status model unchanged; the To Merge (`local`/`mr`) gate path unchanged.
- Reject comment body format: `QA rejected — <reason>`.
- The server holds the Linear API key; the client never calls Linear directly.

---

## File Structure

- `src/server/linear.ts` — **modify**: add `getIssueRef`, `setIssueStatus`, `postComment`.
- `src/server/qaVerdict.ts` — **create**: `resolveQaVerdict` + `QaVerdictError`.
- `src/app/api/sessions/[id]/advance/route.ts` — **modify**: branch on To QA verdict.
- `src/components/TerminalView.tsx` — **modify**: inline reject-reason field; pass `reason`.
- `tests/server/linear.test.ts` — **modify**: cover the new mutations.
- `tests/server/qaVerdict.test.ts` — **create**.

---

### Task 1: Linear write helpers

**Files:**
- Modify: `src/server/linear.ts`
- Test: `tests/server/linear.test.ts`

**Interfaces:**
- Consumes: existing `query<T>(apiKey, body, fetchImpl)` and `parseIdentifier(identifier)` in the same module.
- Produces:
  - `getIssueRef(apiKey: string, identifier: string, fetchImpl?: typeof fetch): Promise<{ id: string; teamId: string; statusName: string }>`
  - `setIssueStatus(apiKey: string, identifier: string, targetStateName: string, fetchImpl?: typeof fetch): Promise<void>`
  - `postComment(apiKey: string, identifier: string, body: string, fetchImpl?: typeof fetch): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Append to `tests/server/linear.test.ts` (the existing `fakeFetch` helper returns `{ ok: true, json: () => ({ data: payload }) }` — for multi-call sequences use a `vi.fn` that returns queued payloads):

```typescript
import { getIssueRef, setIssueStatus, postComment } from "@/server/linear";

function seqFetch(payloads: unknown[]) {
  let i = 0;
  return vi.fn(async () => ({ ok: true, json: async () => ({ data: payloads[i++] }) })) as unknown as typeof fetch;
}

describe("linear mutations", () => {
  it("resolves an issue ref (node id + team id + status)", async () => {
    const f = fakeFetch({ issues: { nodes: [{ id: "issue-uuid", state: { name: "To QA" }, team: { id: "team-uuid" } }] } });
    expect(await getIssueRef("k", "RIC-110", f)).toEqual({ id: "issue-uuid", teamId: "team-uuid", statusName: "To QA" });
  });

  it("sets issue status by resolving the target state name to an id", async () => {
    const f = seqFetch([
      { issues: { nodes: [{ id: "issue-uuid", state: { name: "To QA" }, team: { id: "team-uuid" } }] } },
      { team: { states: { nodes: [{ id: "s1", name: "To Code" }, { id: "s2", name: "To Merge" }] } } },
      { issueUpdate: { success: true } },
    ]);
    await setIssueStatus("k", "RIC-110", "To Merge", f);
    const updateCall = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[2][1] as { body: string };
    expect(updateCall.body).toContain("issueUpdate");
    expect(updateCall.body).toContain("s2");
    expect(updateCall.body).toContain("issue-uuid");
  });

  it("throws when the target state does not exist in the team", async () => {
    const f = seqFetch([
      { issues: { nodes: [{ id: "issue-uuid", state: { name: "To QA" }, team: { id: "team-uuid" } }] } },
      { team: { states: { nodes: [{ id: "s1", name: "To Code" }] } } },
    ]);
    await expect(setIssueStatus("k", "RIC-110", "To Merge", f)).rejects.toThrow(/To Merge/);
  });

  it("posts a comment on the resolved issue node", async () => {
    const f = seqFetch([
      { issues: { nodes: [{ id: "issue-uuid", state: { name: "To QA" }, team: { id: "team-uuid" } }] } },
      { commentCreate: { success: true } },
    ]);
    await postComment("k", "RIC-110", "QA rejected — nope", f);
    const commentCall = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[1][1] as { body: string };
    expect(commentCall.body).toContain("commentCreate");
    expect(commentCall.body).toContain("issue-uuid");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/linear.test.ts`
Expected: FAIL — `getIssueRef`/`setIssueStatus`/`postComment` are not exported.

- [ ] **Step 3: Implement the helpers**

Append to `src/server/linear.ts`:

```typescript
export async function getIssueRef(
  apiKey: string,
  identifier: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ id: string; teamId: string; statusName: string }> {
  const { teamKey, number } = parseIdentifier(identifier);
  const data = await query<{ issues: { nodes: { id?: string; state?: { name?: string }; team?: { id?: string } }[] } }>(
    apiKey,
    {
      query: `query ($key: String!, $n: Float!) {
        issues(filter: { team: { key: { eq: $key } }, number: { eq: $n } }, first: 1) {
          nodes { id state { name } team { id } }
        }
      }`,
      variables: { key: teamKey, n: number },
    },
    fetchImpl,
  );
  const node = data.issues.nodes[0];
  if (!node?.id || !node.team?.id) throw new Error(`issue not found: ${identifier}`);
  return { id: node.id, teamId: node.team.id, statusName: node.state?.name ?? "" };
}

export async function setIssueStatus(
  apiKey: string,
  identifier: string,
  targetStateName: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const ref = await getIssueRef(apiKey, identifier, fetchImpl);
  const states = await query<{ team: { states: { nodes: { id: string; name: string }[] } } }>(
    apiKey,
    {
      query: `query ($teamId: String!) {
        team(id: $teamId) { states { nodes { id name } } }
      }`,
      variables: { teamId: ref.teamId },
    },
    fetchImpl,
  );
  const target = states.team.states.nodes.find((s) => s.name === targetStateName);
  if (!target) throw new Error(`workflow state "${targetStateName}" not found in team`);
  await query<{ issueUpdate: { success: boolean } }>(
    apiKey,
    {
      query: `mutation ($id: String!, $stateId: String!) {
        issueUpdate(id: $id, input: { stateId: $stateId }) { success }
      }`,
      variables: { id: ref.id, stateId: target.id },
    },
    fetchImpl,
  );
}

export async function postComment(
  apiKey: string,
  identifier: string,
  body: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const ref = await getIssueRef(apiKey, identifier, fetchImpl);
  await query<{ commentCreate: { success: boolean } }>(
    apiKey,
    {
      query: `mutation ($issueId: String!, $body: String!) {
        commentCreate(input: { issueId: $issueId, body: $body }) { success }
      }`,
      variables: { issueId: ref.id, body },
    },
    fetchImpl,
  );
}
```

Note: the test asserts the resolved state id / node id appear in the request body. `query()` serializes `variables` into the JSON body, so `s2` and `issue-uuid` are present as variable values — the assertions hold.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/linear.test.ts`
Expected: PASS (all cases, including the existing two).

- [ ] **Step 5: Commit**

```bash
git add src/server/linear.ts tests/server/linear.test.ts
git commit -m "feat(mojito): add Linear setIssueStatus/postComment helpers (RIC-110)"
```

---

### Task 2: qaVerdict orchestration

**Files:**
- Create: `src/server/qaVerdict.ts`
- Test: `tests/server/qaVerdict.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks (pure; deps injected).
- Produces:
  - `type QaArg = "approve" | "reject"`
  - `class QaVerdictError extends Error`
  - `interface QaVerdictDeps { setIssueStatus(ticket, target): Promise<void>; postComment(ticket, body): Promise<void>; }`
  - `resolveQaVerdict(input: { ticket: string; arg: QaArg; reason?: string }, deps: QaVerdictDeps): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `tests/server/qaVerdict.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { resolveQaVerdict, QaVerdictError } from "@/server/qaVerdict";

function deps() {
  return { setIssueStatus: vi.fn(async () => {}), postComment: vi.fn(async () => {}) };
}

describe("resolveQaVerdict", () => {
  it("approve moves the ticket to To Merge and posts no comment", async () => {
    const d = deps();
    await resolveQaVerdict({ ticket: "RIC-110", arg: "approve" }, d);
    expect(d.setIssueStatus).toHaveBeenCalledWith("RIC-110", "To Merge");
    expect(d.postComment).not.toHaveBeenCalled();
  });

  it("reject posts the reason comment then moves to To Code, in that order", async () => {
    const d = deps();
    const order: string[] = [];
    d.postComment.mockImplementation(async () => { order.push("comment"); });
    d.setIssueStatus.mockImplementation(async () => { order.push("status"); });
    await resolveQaVerdict({ ticket: "RIC-110", arg: "reject", reason: "layout broken" }, d);
    expect(d.postComment).toHaveBeenCalledWith("RIC-110", "QA rejected — layout broken");
    expect(d.setIssueStatus).toHaveBeenCalledWith("RIC-110", "To Code");
    expect(order).toEqual(["comment", "status"]);
  });

  it("reject with a blank reason throws and touches nothing", async () => {
    const d = deps();
    await expect(resolveQaVerdict({ ticket: "RIC-110", arg: "reject", reason: "   " }, d))
      .rejects.toBeInstanceOf(QaVerdictError);
    expect(d.postComment).not.toHaveBeenCalled();
    expect(d.setIssueStatus).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/qaVerdict.test.ts`
Expected: FAIL — module `@/server/qaVerdict` not found.

- [ ] **Step 3: Implement**

Create `src/server/qaVerdict.ts`:

```typescript
export type QaArg = "approve" | "reject";

export class QaVerdictError extends Error {}

export interface QaVerdictDeps {
  setIssueStatus: (ticket: string, target: string) => Promise<void>;
  postComment: (ticket: string, body: string) => Promise<void>;
}

/**
 * Resolve a To QA verdict without launching a claude session:
 *  - approve -> set status To Merge (no comment).
 *  - reject  -> post the rejection reason as a comment, then set status To Code.
 * Comment is posted before the status change so a rejection is never statused
 * back without its reason on record.
 */
export async function resolveQaVerdict(
  input: { ticket: string; arg: QaArg; reason?: string },
  deps: QaVerdictDeps,
): Promise<void> {
  const { ticket, arg, reason } = input;
  if (arg === "approve") {
    await deps.setIssueStatus(ticket, "To Merge");
    return;
  }
  const trimmed = (reason ?? "").trim();
  if (!trimmed) throw new QaVerdictError("rejection reason required");
  await deps.postComment(ticket, `QA rejected — ${trimmed}`);
  await deps.setIssueStatus(ticket, "To Code");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/qaVerdict.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/qaVerdict.ts tests/server/qaVerdict.test.ts
git commit -m "feat(mojito): add resolveQaVerdict orchestration (RIC-110)"
```

---

### Task 3: Branch the advance route on the To QA verdict

**Files:**
- Modify: `src/app/api/sessions/[id]/advance/route.ts`

**Interfaces:**
- Consumes: `resolveQaVerdict`, `QaVerdictError` (Task 2); `setIssueStatus`, `postComment` (Task 1); existing `getIssueStatus`, `supersedeSession`, `getRegistry`, `getConfig`.
- Produces: no new exports (route handler behavior only).

- [ ] **Step 1: Add imports**

At the top of the route file, extend the existing imports:

```typescript
import { getIssueStatus, setIssueStatus, postComment } from "@/server/linear";
import { resolveQaVerdict, QaVerdictError } from "@/server/qaVerdict";
```

- [ ] **Step 2: Read `reason` from the body**

Change the destructure after `body = await req.json()`:

```typescript
  const { arg, reason } = body;
```

- [ ] **Step 3: Insert the To QA branch**

Immediately after `const status = await getIssueStatus(cfg.linearApiKey, prev.ticket);` and before the `const registry = getRegistry();` line that begins the launch path, insert:

```typescript
  // To QA verdict is a pure Linear mutation — resolve it in-process instead of
  // launching a claude/lime session (RIC-110). The To Merge gate (local/mr) still
  // falls through to the launch path below.
  if (status === "To QA" && (arg === "approve" || arg === "reject")) {
    try {
      await resolveQaVerdict(
        { ticket: prev.ticket, arg, reason },
        {
          setIssueStatus: (t, s) => setIssueStatus(cfg.linearApiKey, t, s),
          postComment: (t, b) => postComment(cfg.linearApiKey, t, b),
        },
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : "verdict failed";
      return NextResponse.json({ error: message }, { status: e instanceof QaVerdictError ? 400 : 422 });
    }
    await supersedeSession(id, { closeSession, registry: getRegistry() });
    return NextResponse.json({ ok: true, arg }, { status: 200 });
  }
```

(`VALID_ARGS` already rejects anything other than approve/reject/local/mr before this point, so the branch is only reached for a legitimate approve/reject at To QA.)

- [ ] **Step 4: Verify types and full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS, no type errors. (The launch path for To Merge is untouched; existing tests still pass.)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/sessions/[id]/advance/route.ts
git commit -m "feat(mojito): resolve To QA verdict in advance route without launching (RIC-110)"
```

---

### Task 4: Inline reject-reason field in TerminalView

**Files:**
- Modify: `src/components/TerminalView.tsx`

**Interfaces:**
- Consumes: existing `advance`, `advErr`, `session.launchStatus`, `apiFetch`.
- Produces: no new exports (component behavior only).

- [ ] **Step 1: Add reject UI state**

Near the other `useState` hooks in the component, add:

```typescript
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
```

- [ ] **Step 2: Thread `reason` through `advance`**

Change the `advance` signature and body-building to send the reason when present:

```typescript
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

- [ ] **Step 3: Render the To QA reason flow**

Replace the gate `<div className="btns">…</div>` block. For `To QA`, show `approve` plus a reject flow with an inline textarea; for the To Merge gate, keep the current `local`/`mr` buttons:

```tsx
          <div className="btns">
            {session.launchStatus === "To QA" ? (
              <>
                <button className="btn primary" onClick={() => advance("approve")}>approve</button>
                {rejecting ? (
                  <>
                    <textarea
                      className="reason"
                      placeholder="Rejection reason…"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                    <button
                      className="btn danger"
                      disabled={!reason.trim()}
                      onClick={() => advance("reject", reason)}
                    >
                      confirm reject
                    </button>
                  </>
                ) : (
                  <button className="btn danger" onClick={() => setRejecting(true)}>reject</button>
                )}
              </>
            ) : (
              ["local", "mr"].map((a) => (
                <button key={a} className="btn primary" onClick={() => advance(a)}>{a}</button>
              ))
            )}
          </div>
```

- [ ] **Step 4: Add minimal styling for the textarea**

In `src/app/globals.css`, add a small rule near the existing `.gate` styles (search for `.gate`):

```css
.gate .reason {
  width: 100%;
  min-height: 60px;
  padding: 8px;
  font: inherit;
  resize: vertical;
}
```

- [ ] **Step 5: Verify types and build**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Manual verification**

With the app running (`npm run dev`), open a session whose ticket is at **To QA**:
- `approve` → ticket moves to To Merge in Linear, session retired, back to list.
- `reject` → textarea appears; confirm disabled until text entered; on confirm, a `QA rejected — …` comment is posted and the ticket moves to To Code.
- A session at **To Merge** still shows `local` / `mr` and launches a session as before.

- [ ] **Step 7: Commit**

```bash
git add src/components/TerminalView.tsx src/app/globals.css
git commit -m "feat(mojito): inline reject-reason field for To QA gate (RIC-110)"
```

---

## Self-Review

**Spec coverage:**
- approve → To Merge, no comment → Task 2 (approve) + Task 3 (route) + Task 4 (button). ✓
- reject → reason comment + To Code → Task 2 (reject) + Task 1 (postComment/setIssueStatus) + Task 4 (inline field). ✓
- Linear mutations added to read-only `linear.ts` → Task 1. ✓
- To Merge gate unchanged → Task 3 branch condition + Task 4 else-branch. ✓
- Missing target state fails loudly (422) → Task 1 throw + Task 3 catch. ✓
- Empty reason rejected (400) → Task 2 throw + Task 3 status mapping + Task 4 disabled confirm. ✓
- No lime change / status model untouched → nothing in the plan edits lime or `autoAdvance.ts`. ✓

**Placeholder scan:** none — every code step has full code.

**Type consistency:** `getIssueRef` returns `{ id, teamId, statusName }`, consumed only inside `setIssueStatus`/`postComment`. `resolveQaVerdict(input, deps)` signature identical across Task 2 definition and Task 3 call site. `advance(arg, reason?)` matches its call sites (`advance("approve")`, `advance("reject", reason)`, `advance(a)`). ✓
