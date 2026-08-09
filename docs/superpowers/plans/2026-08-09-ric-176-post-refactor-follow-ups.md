# RIC-176 Post-Refactor Follow-Ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the QA verdict outcome in `LaunchSheet` (MR link, conflict notice with an open-session button), delete the dead `postComment`, and pin `LAUNCHABLE_STATUSES` to `WORK_STATES` with a sync test.

**Architecture:** Three independent changes plus one minor logging fix. Tasks 1–3 touch disjoint files and can be done in any order. Task 4 widens the server-side verdict contract so the conflict outcome carries the launched session's tmux id; Task 5 consumes that in the client. Task 5 depends on Task 4 and on nothing else.

**Tech Stack:** Next.js 15 App Router, React 19 client components, TypeScript (strict), Vitest. No new dependencies.

## Global Constraints

- All code artifacts in English: identifiers, comments, log messages, commit messages.
- Spec: `docs/superpowers/specs/2026-08-09-ric-176-post-refactor-follow-ups-design.md`.
- Verification command for every task: `npx tsc --noEmit && npx vitest run`.
- Work in the worktree `/home/mojito/code/mojito/.claude/worktrees/ricventu+ric-176-post-refactor-follow-ups` on branch `ricventu/ric-176-post-refactor-follow-ups`. Verify the branch with `git branch --show-current` before committing.
- Never call Linear (no MCP, no API, no comments) from this work.
- Do not run `npm install` in the worktree — `node_modules` is a symlink to the main checkout's and is already in place.
- Follow the surrounding comment style: explain *why*, not *what*. Match existing density.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/server/linear.ts` | GraphQL client — loses `postComment` | 1 |
| `tests/server/linear.test.ts` | loses the `postComment` case | 1 |
| `src/lib/stageDefaults.ts` | comment naming `statusModel.ts` as the source of truth | 2 |
| `src/server/statusModel.ts` | comment naming `stageDefaults.ts` as a mirror | 2 |
| `tests/lib/stageDefaults.test.ts` | new sync guard | 2 |
| `src/app/api/sessions/route.ts` | warn on a failed best-effort board move | 3 |
| `tests/server/sessionsRoute.test.ts` | covers that warning | 3 |
| `src/server/qaVerdict.ts` | conflict arm carries `sessionId` | 4 |
| `src/app/api/tickets/[id]/verdict/route.ts` | `launchConflictFix` returns the id | 4 |
| `tests/server/qaVerdict.test.ts`, `tests/server/verdictRoute.test.ts` | assert the id flows through | 4 |
| `src/components/LaunchSheet.tsx` | outcome panel | 5 |
| `src/app/globals.css` | outcome panel styling | 5 |

---

### Task 1: Delete the dead `postComment`

**Files:**
- Modify: `src/server/linear.ts:313-330` (delete the function)
- Modify: `tests/server/linear.test.ts:2` (import list), `tests/server/linear.test.ts:123-132` (delete the case)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. `postComment` ceases to exist; no other module imports it.

- [ ] **Step 1: Confirm there is no production call site**

Run: `grep -rn "postComment" src/ tests/`

Expected: exactly three hits — `src/server/linear.ts:313`, and two in `tests/server/linear.test.ts` (the import on line 2 and the call on line 128). If any other file appears, STOP and report it instead of deleting.

- [ ] **Step 2: Delete the function from `src/server/linear.ts`**

Delete this entire block (it sits between `setIssueAssignee` and `uploadImage`), leaving one blank line between the two neighbours:

```ts
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

- [ ] **Step 3: Delete its test case**

In `tests/server/linear.test.ts`, remove `postComment` from the import on line 2 so it reads:

```ts
import { listOpenIssues, getIssueStatus, getIssueRef, setIssueStatus, setIssueAssignee, uploadImage, getIssueContent, createIssue, downloadLinearAsset } from "@/server/linear";
```

and delete this whole `it` block:

```ts
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
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npx vitest run tests/server/linear.test.ts`

Expected: tsc silent (a leftover reference would be a compile error), linear tests pass with one fewer case than before.

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # must print ricventu/ric-176-post-refactor-follow-ups
git add src/server/linear.ts tests/server/linear.test.ts
git commit -m "refactor(linear): drop the unused postComment

Mojito never writes Linear comments — the rejection reason reaches the
rework session through its context file. No production call site has
existed since the native-lifecycle refactor."
```

---

### Task 2: Pin `LAUNCHABLE_STATUSES` to `WORK_STATES`

**Files:**
- Modify: `src/lib/stageDefaults.ts:12-13` (comment)
- Modify: `src/server/statusModel.ts:1-5` (comment)
- Modify: `tests/lib/stageDefaults.test.ts` (new describe block, new import)

**Interfaces:**
- Consumes: `WORK_STATES` from `@/server/statusModel` (a `string[]`, currently `["Backlog", "Todo", "In Progress"]`).
- Produces: nothing new at runtime. `LAUNCHABLE_STATUSES` keeps its current type and value.

Note: this is a test, not an import. `src/lib/stageDefaults.ts` is client code reached from `LaunchSheet`; importing a server module for three string literals would cross a boundary the codebase keeps deliberately. The precedent is `src/lib/status.ts` ↔ `src/server/statusModel.ts`, tied by `tests/lib/status.test.ts`.

- [ ] **Step 1: Write the failing test**

Append to `tests/lib/stageDefaults.test.ts`:

```ts
describe("LAUNCHABLE_STATUSES / WORK_STATES sync", () => {
  it("is exactly the server model's work states, in the same order", () => {
    expect(LAUNCHABLE_STATUSES).toEqual(WORK_STATES);
  });

  it("gives every launchable status a built-in seed default", () => {
    expect(Object.keys(BUILTIN_STAGE_DEFAULTS).sort()).toEqual([...LAUNCHABLE_STATUSES].sort());
  });
});
```

and add the import below the existing `@/lib/stageDefaults` import block:

```ts
import { WORK_STATES } from "@/server/statusModel";
```

`STAGE_DEFAULT_ROWS` needs no new guard — `tests/lib/stageDefaults.test.ts:47` already pins it to `LAUNCHABLE_STATUSES`, so pinning that to `WORK_STATES` covers the rows transitively.

- [ ] **Step 2: Run it and confirm it passes today, then confirm it can fail**

Run: `npx vitest run tests/lib/stageDefaults.test.ts`
Expected: PASS — the two lists agree right now; the test exists to catch future drift.

Prove the guard actually bites: temporarily add `"Review"` to `WORK_STATES` in `src/server/statusModel.ts`, re-run the same command, and confirm **both** new cases fail (the first on the list mismatch, the second on the missing built-in). Then revert that edit with `git checkout src/server/statusModel.ts` and re-run to confirm green again.

A guard that has never been seen red is not a guard. Do not skip this step.

- [ ] **Step 3: Cross-reference the two source files**

In `src/lib/stageDefaults.ts`, replace the comment on line 12:

```ts
// The launchable lifecycle statuses (terminal states never launch, so they are not configured).
```

with:

```ts
// The launchable lifecycle statuses (terminal states never launch, so they are not configured).
// Mirrors WORK_STATES in src/server/statusModel.ts — kept in sync by
// tests/lib/stageDefaults.test.ts. Mirrored rather than imported: this module is client
// code (LaunchSheet imports it), and the server model must not reach the browser bundle.
```

In `src/server/statusModel.ts`, extend the header comment so the pointer is bidirectional. The block currently ends:

```ts
// terminal states. Kept in sync with src/lib/status.ts (STATUS_ORDER/STATUS_COLOR) by
// tests/lib/status.test.ts.
```

Make it:

```ts
// terminal states. Kept in sync with src/lib/status.ts (STATUS_ORDER/STATUS_COLOR) by
// tests/lib/status.test.ts, and with src/lib/stageDefaults.ts (LAUNCHABLE_STATUSES) by
// tests/lib/stageDefaults.test.ts.
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc silent, all tests pass (2 more than the baseline 661).

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # must print ricventu/ric-176-post-refactor-follow-ups
git add src/lib/stageDefaults.ts src/server/statusModel.ts tests/lib/stageDefaults.test.ts
git commit -m "test(stage-defaults): pin LAUNCHABLE_STATUSES to WORK_STATES

The same three statuses were maintained in two files with nothing tying
them together: a new work state would have silently fallen through to
FALLBACK (opus/high) and been rejected by validateStageDefaults."
```

---

### Task 3: Warn when the best-effort board move fails

**Files:**
- Modify: `src/app/api/sessions/route.ts:82-84`
- Modify: `tests/server/sessionsRoute.test.ts` (one new case)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing. Behaviour is unchanged — the route still returns 201; only a warning is added.

- [ ] **Step 1: Write the failing test**

Add to the `describe("POST /api/sessions (ticket)", ...)` block in `tests/server/sessionsRoute.test.ts`:

```ts
  // The board move is best-effort by design (the session is already running, so a failed
  // status write must not fail the request) — but silence made a stuck board look normal.
  it("still returns 201 and warns when the Backlog -> In Progress board move fails", async () => {
    h.setIssueStatus.mockImplementation(async () => { throw new Error("Linear 500"); });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const res = await POST(req({ ...launch, status: "Backlog" }));
      expect(res.status).toBe(201);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("RIC-46"));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("Linear 500"));
    } finally {
      warn.mockRestore();
    }
  });
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run tests/server/sessionsRoute.test.ts`
Expected: FAIL on the `warn` assertions — the request already returns 201, but nothing is logged.

- [ ] **Step 3: Add the warning**

In `src/app/api/sessions/route.ts`, replace:

```ts
  if (body.status === "Backlog" || body.status === "Todo") {
    try { await setIssueStatus(cfg.linearApiKey, body.ticket, "In Progress"); } catch { /* board update is best-effort */ }
  }
```

with:

```ts
  if (body.status === "Backlog" || body.status === "Todo") {
    // Best-effort: the session is already running, so a failed status write must not fail
    // the request — but it does leave the board behind, so say so rather than swallowing it.
    try {
      await setIssueStatus(cfg.linearApiKey, body.ticket, "In Progress");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`sessions route: setIssueStatus failed for ${body.ticket}: ${message}`);
    }
  }
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run tests/server/sessionsRoute.test.ts`
Expected: PASS, 6 cases in the file.

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # must print ricventu/ric-176-post-refactor-follow-ups
git add src/app/api/sessions/route.ts tests/server/sessionsRoute.test.ts
git commit -m "fix(sessions): warn when the best-effort board move fails

A failed Backlog -> In Progress write left the board behind with nothing
in the log, matching the warning the description fetch already emits."
```

---

### Task 4: Carry the conflict session's id out of the verdict

**Files:**
- Modify: `src/server/qaVerdict.ts:12` (dep signature), `src/server/qaVerdict.ts:18` (result type), `src/server/qaVerdict.ts:53-57` (conflict case)
- Modify: `src/app/api/tickets/[id]/verdict/route.ts:91-101` (`launchConflictFix` returns `sid`)
- Modify: `tests/server/qaVerdict.test.ts:10` and `:39-45`
- Modify: `tests/server/verdictRoute.test.ts:183-194`

**Interfaces:**
- Consumes: `conflictSessionName(ticket)` from `@/server/sessionKey`, already imported by the route; it returns `mojito-<ticket>-conflict`.
- Produces, for Task 5:
  - `QaVerdictResult` = `{done:"merged"; commit:string} | {done:"mr-created"; url:string} | {done:"conflict-session"; sessionId:string} | {done:"rework-session"}`, exported from `@/server/qaVerdict`.
  - `POST /api/tickets/[id]/verdict` returns `{ok: true, result: QaVerdictResult}` on success (unchanged shape, richer conflict arm).

- [ ] **Step 1: Write the failing tests**

In `tests/server/qaVerdict.test.ts`, change the `launchConflictFix` mock in the `deps` helper from `vi.fn(async () => {})` to:

```ts
    launchConflictFix: vi.fn(async () => "mojito-RIC-110-conflict"),
```

and replace the conflict case's final assertion so it reads:

```ts
  it("a merge conflict launches the conflict-fix session and writes NO status", async () => {
    const d = deps({ status: "conflict", detail: "CONFLICT (content): src/a.ts" });
    const res = await resolveQaVerdict({ ticket: "RIC-110", arg: "approve-local" }, d);
    expect(d.launchConflictFix).toHaveBeenCalledWith("CONFLICT (content): src/a.ts");
    expect(d.setIssueStatus).not.toHaveBeenCalled();
    expect(res).toEqual({ done: "conflict-session", sessionId: "mojito-RIC-110-conflict" });
  });
```

In `tests/server/verdictRoute.test.ts`, change the expected body in the conflict case:

```ts
    expect(await res.json()).toEqual({
      ok: true, result: { done: "conflict-session", sessionId: "mojito-RIC-110-conflict" },
    });
```

- [ ] **Step 2: Run them and verify they fail**

Run: `npx vitest run tests/server/qaVerdict.test.ts tests/server/verdictRoute.test.ts`
Expected: both conflict cases FAIL — the result objects lack `sessionId`.

- [ ] **Step 3: Widen the contract in `src/server/qaVerdict.ts`**

Change the dep signature on line 12 from:

```ts
  launchConflictFix: (detail: string) => Promise<void>;
```

to:

```ts
  // Returns the launched session's tmux id, so the caller can offer to open it.
  launchConflictFix: (detail: string) => Promise<string>;
```

Change the result arm on line 18 from:

```ts
  | { done: "conflict-session" }
```

to:

```ts
  | { done: "conflict-session"; sessionId: string }
```

Change the conflict case (note the braces — a `const` needs its own block inside a `switch`):

```ts
    case "conflict": {
      // The branch is not merged and history was not moved: leave the ticket at To QA
      // so the conflict-fix session's own result can drive the next transition.
      const sessionId = await deps.launchConflictFix(outcome.detail);
      return { done: "conflict-session", sessionId };
    }
```

- [ ] **Step 4: Return the id from the route**

In `src/app/api/tickets/[id]/verdict/route.ts`, the `launchConflictFix` callback already computes `sid`. Add the return:

```ts
          launchConflictFix: async () => {
            const sid = conflictSessionName(id);
            if (registry.get(sid)) await supersedeSession(sid, { closeSession, registry });
            const status = "In Progress";
            const res = await launchConflictSession(
              { ticket: id, projectName, title, description: (await content()).description,
                model: defaultModelForStatus(status), effort: defaultEffortForStatus(status) },
              tmuxDeps,
            );
            if (!res.ok) throw new Error(`conflict session not launched: ${res.reason}`);
            return sid;
          },
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `npx tsc --noEmit && npx vitest run tests/server/qaVerdict.test.ts tests/server/verdictRoute.test.ts`
Expected: tsc silent, all cases pass.

- [ ] **Step 6: Commit**

```bash
git branch --show-current   # must print ricventu/ric-176-post-refactor-follow-ups
git add src/server/qaVerdict.ts src/app/api/tickets/\[id\]/verdict/route.ts tests/server/qaVerdict.test.ts tests/server/verdictRoute.test.ts
git commit -m "feat(qa): carry the conflict session id in the verdict result

The client cannot offer to open the conflict session without its tmux
id, and recomputing it browser-side would guess at a server decision."
```

---

### Task 5: Show the verdict outcome in `LaunchSheet`

**Files:**
- Modify: `src/components/LaunchSheet.tsx` (imports, `submitVerdict`, new state, new render branch)
- Modify: `src/app/globals.css` (one new block after `.sheet-title`, line 252)

**Interfaces:**
- Consumes from Task 4: `QaVerdictResult` (type-only import from `@/server/qaVerdict`), and the conflict arm's `sessionId`.
- Produces: nothing consumed by other tasks — this is the last one.

Behaviour, from the spec: *Approve · merge* and *reject* keep closing the sheet exactly as today; *Approve · MR* and a merge conflict hold it open with an outcome panel.

- [ ] **Step 1: Add the type-only import and the outcome state**

At the top of `src/components/LaunchSheet.tsx`, add to the import block:

```ts
import type { QaVerdictResult } from "@/server/qaVerdict";
```

It must be `import type` — a value import would pull `qaVerdict.ts` and its `merge.ts` dependency (which imports `node:child_process`) into the client bundle.

Next to the other `useState` calls, after `verdictPending`:

```ts
  // Set only for the two outcomes that carry information the user cannot get from the
  // board or the session list: the MR URL, and the fact that a merge conflict happened.
  // The other two close the sheet, as they always have.
  const [outcome, setOutcome] = useState<QaVerdictResult | null>(null);
```

- [ ] **Step 2: Parse the success body in `submitVerdict`**

Replace the success line `if (res.ok) { onLaunched(); onClose(); return; }` with:

```ts
      if (res.ok) {
        // Refresh either way: every verdict moves the board, launches a session, or both.
        onLaunched();
        let result: unknown = null;
        try { result = (await res.json())?.result; } catch { /* keep null and just close */ }
        if (holdsSheetOpen(result)) setOutcome(result);
        else onClose();
        return;
      }
```

- [ ] **Step 3: Add the result guard above the component**

Between the imports and `export default function LaunchSheet`, add:

```ts
// The two verdict outcomes worth holding the sheet open for. Anything else — including a
// body from a server that predates or postdates this client — closes the sheet, so a
// version skew degrades to the old behaviour instead of showing a blank panel.
function holdsSheetOpen(r: unknown): r is Extract<QaVerdictResult, { done: "mr-created" | "conflict-session" }> {
  if (r === null || typeof r !== "object") return false;
  const done = (r as { done?: unknown }).done;
  if (done === "mr-created") return typeof (r as { url?: unknown }).url === "string";
  if (done === "conflict-session") return typeof (r as { sessionId?: unknown }).sessionId === "string";
  return false;
}
```

- [ ] **Step 4: Render the outcome panel**

Inside the component, just before the final `return (`, add the panel and the conflict-session lookup:

```ts
  // The conflict session is registered before the verdict responds, so the onLaunched()
  // refetch normally has it by the time this renders — but the prop update is a round trip
  // behind, so the button says what it is waiting for instead of silently doing nothing.
  // Looking the session up by id in the live list is how page.tsx opens alerts, too.
  const conflictSession = outcome?.done === "conflict-session"
    ? sessions.find((s) => s.id === outcome.sessionId)
    : undefined;
```

Then replace the whole `return (...)` body's inner content so that an outcome short-circuits everything else. The sheet keeps its header and shows only the panel:

```tsx
  if (outcome) {
    return (
      <div className="sheet-backdrop" onClick={onClose}>
        <div className="sheet" onClick={(e) => e.stopPropagation()}>
          <h3><span className="id" style={{ fontSize: 16 }}>{ticket.identifier}</span> <span className="chip">{ticket.statusName}</span></h3>
          {outcome.done === "mr-created" ? (
            <div className="outcome">
              <p className="outcome-head">MR opened · {ticket.identifier} moved to Done</p>
              <a className="outcome-link" href={outcome.url} target="_blank" rel="noreferrer">{outcome.url}</a>
            </div>
          ) : (
            <div className="outcome warn">
              <p className="outcome-head">Merge conflict — the branch was not merged</p>
              <p className="outcome-body">
                The rebase stopped on a conflict, so {ticket.identifier} stays at To QA.
                A conflict session was launched to resolve it.
              </p>
              <button className="btn primary block" style={{ marginTop: 12 }}
                disabled={!conflictSession}
                onClick={() => conflictSession && onOpen(conflictSession)}>
                {conflictSession ? "Open conflict session" : "Starting…"}
              </button>
            </div>
          )}
          <button className="btn ghost block" style={{ marginTop: 12 }} onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }

```

This block goes immediately before the existing `return (` — the existing return is left untouched.

- [ ] **Step 5: Add the CSS**

In `src/app/globals.css`, after the `.sheet-title` rule (line 252), add:

```css
.outcome { border: 1px solid var(--border-hi); border-radius: var(--r-sm);
  padding: 12px; background: var(--bg); margin: 0 0 4px; }
.outcome.warn { border-color: color-mix(in srgb, var(--attn) 40%, var(--border)); background: var(--attn-bg); }
.outcome-head { margin: 0; font: 600 14px/1.35 var(--mono); color: var(--text); }
.outcome-body { margin: 8px 0 0; font-size: 13px; color: var(--text-dim); }
/* The MR URL is long and the sheet is phone-width: wrap it anywhere rather than
   letting it push the sheet into a horizontal scroll. */
.outcome-link { display: block; margin-top: 8px; font: 13px/1.4 var(--mono);
  color: var(--accent); overflow-wrap: anywhere; }
```

Check that `--r-sm`, `--border-hi`, `--bg`, `--attn`, `--attn-bg`, `--text-dim` and `--mono` all exist in the `:root` block at the top of the file before using them; if any is missing, substitute the nearest token that does exist and note the substitution in your report.

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc silent, all tests pass.

Then confirm the type-only import really is erased — a value import here would break the build:

Run: `npx next build 2>&1 | tail -20`
Expected: the build completes. If it fails with anything mentioning `child_process`, `node:`, or `qaVerdict`, the import on Step 1 lost its `type` keyword.

- [ ] **Step 7: Commit**

```bash
git branch --show-current   # must print ricventu/ric-176-post-refactor-follow-ups
git add src/components/LaunchSheet.tsx src/app/globals.css
git commit -m "feat(qa): surface the verdict outcome in the launch sheet

Approve · MR dropped the MR URL on the floor and a rebase conflict looked
exactly like a clean merge. Those two now hold the sheet open — the MR
link, and a conflict notice that opens the session it launched. Clean
merge and reject close the sheet as before."
```

---

## Self-Review

**Spec coverage.**

| Spec requirement | Task |
|---|---|
| MR URL shown after *Approve · MR* | 5 |
| Conflict notice, ticket stays at To QA | 5 |
| *Open conflict session* button, id from the server | 4 + 5 |
| Clean merge / reject keep closing the sheet | 5 (Step 2 branch) |
| Unknown result shape degrades to closing | 5 (Step 3 guard) |
| Type-only import keeps server code out of the bundle | 5 (Steps 1, 6) |
| `postComment` deleted with its test | 1 |
| `LAUNCHABLE_STATUSES` pinned to `WORK_STATES` | 2 |
| Built-in default per launchable status | 2 |
| Bidirectional source comments | 2 (Step 3) |
| Warn on failed best-effort board move | 3 |

No gaps.

**Type consistency.** `QaVerdictResult`'s conflict arm is `{done:"conflict-session"; sessionId:string}` in Task 4 and read as `outcome.sessionId` in Task 5. `launchConflictFix` returns `Promise<string>` in Task 4's dep type, its route implementation, and its test mock. `holdsSheetOpen` narrows to the same two arms the render branch handles.

**Placeholders.** None — every code step carries the literal text to write.
