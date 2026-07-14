# Needs-input Stuck Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a session's `needs-input` badge return to `running` when the human unblocks the session (submits a prompt, grants a permission, or the agent resumes), instead of staying `needs-input` until the stage is `done`.

**Architecture:** Session state is driven by Claude Code hooks. The bug is that the only wired transitions back to `running` are `SessionStart` (boot only) and `PostToolUse` scoped to `AskUserQuestion`. The fix wires two "agent is working again" signals: `UserPromptSubmit` (new event → `running`) and a broadened, unmatched `PostToolUse` (all tools → `running`). `PreToolUse` stays scoped to `AskUserQuestion` so it remains the only event that *enters* `needs-input` from a tool. No new `SessionState`, no `Registry` guard, no UI change.

**Tech Stack:** TypeScript, Node, Vitest (node environment), Next.js route handler.

## Global Constraints

- All code artifacts in English (identifiers, comments, commit messages).
- Do NOT change how `needs-input` is *entered*: `Notification`, `PermissionRequest`, `PreToolUse`(`AskUserQuestion`), and `Stop`-with-no-advance keep their current meaning.
- `PreToolUse` MUST stay matched to `AskUserQuestion` (a generic `PreToolUse` would wrongly flip every tool call to `needs-input`).
- `PostToolUse` maps to `running` (already true in `mapHook`); broadening it to all tools is a wiring change only. Patching to `running` is idempotent.
- No new `SessionState`, no state-transition guard in `Registry`, no change to the `Stop`/`SessionEnd` status-advance logic in `handleHook`, no badge/UI change.
- `HookEventName` is exhaustively switched in `mapHook`; adding a member forces a matching `case` (tsc enforces via no-implicit-return).

---

### Task 1: `UserPromptSubmit` clears needs-input (type + mapHook + handler regression)

**Files:**
- Modify: `src/server/types.ts` (add `"UserPromptSubmit"` to `HookEventName`, ~lines 3-10)
- Modify: `src/server/hookMap.ts` (add a `case`, refresh the `PostToolUse` comment)
- Test: `tests/server/hookHandler.test.ts` (append two regression tests)

**Interfaces:**
- Consumes: `handleHook(id, event, deps)` and `mapHook(event, statusAdvanced)` (existing).
- Produces: `mapHook("UserPromptSubmit", *)` → `{ state: "running", alert: null }`. `HookEventName` gains the `"UserPromptSubmit"` member.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe("handleHook", …)` block in `tests/server/hookHandler.test.ts`:

```ts
  it("UserPromptSubmit clears needs-input back to running (RIC-117)", async () => {
    const { registry } = seed({ state: "needs-input", message: "claude is waiting for you" });
    const bus = new EventBus();
    const events: unknown[] = [];
    bus.subscribe((e) => events.push(e));
    await handleHook("mojito-RIC-46-to-code", "UserPromptSubmit", {
      registry, bus, getIssueStatus: async () => "To Code", onAutoAdvance: () => {},
    });
    const m = registry.get("mojito-RIC-46-to-code");
    expect(m?.state).toBe("running");
    expect(m?.message).toBeUndefined();
    expect(events).toContainEqual({ type: "session.state", id: "mojito-RIC-46-to-code", state: "running" });
  });

  it("PostToolUse (any tool) clears needs-input back to running (RIC-117)", async () => {
    const { registry } = seed({ state: "needs-input", message: "claude needs your attention" });
    const bus = new EventBus();
    await handleHook("mojito-RIC-46-to-code", "PostToolUse", {
      registry, bus, getIssueStatus: async () => "To Code", onAutoAdvance: () => {},
    });
    expect(registry.get("mojito-RIC-46-to-code")?.state).toBe("running");
  });
```

(The second test passes even before the fix — the handler already maps `PostToolUse → running`; it is a characterization guard. The wiring that makes it fire for all tools is Task 2. The first test is the genuine red.)

- [ ] **Step 2: Run tests to verify the first one fails**

Run: `npx vitest run tests/server/hookHandler.test.ts`
Expected: FAIL on the `UserPromptSubmit` test — `mapHook` has no `UserPromptSubmit` case, so `outcome` is `undefined` and `handleHook` throws reading `outcome.state`. (`npx tsc --noEmit` also fails: `"UserPromptSubmit"` is not assignable to `HookEventName`.)

- [ ] **Step 3: Add the event to the type**

In `src/server/types.ts`, add `"UserPromptSubmit"` to `HookEventName`:

```ts
export type HookEventName =
  | "SessionStart"
  | "UserPromptSubmit"
  | "PermissionRequest"
  | "Notification"
  | "PreToolUse"
  | "PostToolUse"
  | "Stop"
  | "SessionEnd";
```

- [ ] **Step 4: Add the `mapHook` case and refresh the `PostToolUse` comment**

In `src/server/hookMap.ts`, add a `UserPromptSubmit` case (place it right after the `SessionStart` case) and update the `PostToolUse` comment to reflect that it now covers any tool:

```ts
    case "SessionStart":
      // claude has booted and is now working — leave the transient "starting" state.
      return { state: "running", alert: null };
    case "UserPromptSubmit":
      // The user submitted a prompt — they have responded, so the session is no longer
      // waiting on the human. Back to running (clears a stale needs-input badge).
      return { state: "running", alert: null };
```

```ts
    case "PostToolUse":
      // A tool call finished — the agent is working, not waiting. Clears needs-input
      // (an answered AskUserQuestion, a granted permission's tool, or resumed work).
      return { state: "running", alert: null };
```

- [ ] **Step 5: Run tests + typecheck to verify green**

Run: `npx tsc --noEmit && npx vitest run tests/server/hookHandler.test.ts`
Expected: no type errors; all `handleHook` tests pass (including the two new ones).

- [ ] **Step 6: Commit**

```bash
git add src/server/types.ts src/server/hookMap.ts tests/server/hookHandler.test.ts
git commit -m "fix(mojito): clear needs-input on UserPromptSubmit and any PostToolUse (RIC-117)"
```

---

### Task 2: Wire the resume signals into session hook settings + accept the event

**Files:**
- Modify: `src/server/hookSettings.ts` (add `UserPromptSubmit` and `PostToolUse` to `EVENTS`; drop `PostToolUse` from `MATCHED_EVENTS`)
- Modify: `src/app/api/hook/route.ts` (add `"UserPromptSubmit"` to the `VALID` whitelist, line 9)
- Test: `tests/server/hookSettings.test.ts` (update the two existing assertions, add one)

**Interfaces:**
- Consumes: `HookEventName` with `"UserPromptSubmit"` (Task 1).
- Produces: `buildHookSettings` wires `UserPromptSubmit` and an unmatched (all-tools) `PostToolUse`, keeps `PreToolUse` matched to `AskUserQuestion`. `route.ts` `VALID` accepts `UserPromptSubmit`.

- [ ] **Step 1: Update the failing tests**

Replace the first two `it(...)` blocks in `tests/server/hookSettings.test.ts` and add a third:

```ts
  it("defines every hook event, including the resume signals", () => {
    expect(Object.keys(s.hooks).sort()).toEqual(
      ["Notification", "PermissionRequest", "PostToolUse", "PreToolUse", "SessionEnd", "SessionStart", "Stop", "UserPromptSubmit"].sort(),
    );
  });

  it("scopes PreToolUse to AskUserQuestion and leaves PostToolUse unmatched (all tools)", () => {
    const pre = s.hooks.PreToolUse as { matcher?: string }[];
    const post = s.hooks.PostToolUse as { matcher?: string }[];
    expect(pre[0].matcher).toBe("AskUserQuestion");
    expect(post[0].matcher).toBeUndefined(); // fires for every finished tool -> running
    expect(JSON.stringify(s.hooks.PreToolUse)).toContain("event=PreToolUse");
    expect(JSON.stringify(s.hooks.PostToolUse)).toContain("event=PostToolUse");
  });

  it("wires UserPromptSubmit as an always-on resume signal", () => {
    const ups = s.hooks.UserPromptSubmit as { matcher?: string }[];
    expect(ups[0].matcher).toBeUndefined();
    expect(JSON.stringify(s.hooks.UserPromptSubmit)).toContain("event=UserPromptSubmit");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/hookSettings.test.ts`
Expected: FAIL — current `hookSettings` matches `PostToolUse` to `AskUserQuestion` (so `post[0].matcher` is `"AskUserQuestion"`, not undefined) and defines no `UserPromptSubmit` key.

- [ ] **Step 3: Rewire `hookSettings.ts`**

In `src/server/hookSettings.ts`, add `UserPromptSubmit` and `PostToolUse` to `EVENTS`, and leave only `PreToolUse` in `MATCHED_EVENTS`:

```ts
const EVENTS: HookEventName[] = ["SessionStart", "UserPromptSubmit", "PermissionRequest", "Notification", "PostToolUse", "Stop", "SessionEnd"];

// PreToolUse fires for every tool, so it MUST be scoped by a matcher: only AskUserQuestion
// should drive the "the agent is asking a question" (needs-input) signal. PostToolUse is
// intentionally unmatched (all tools, incl. subagent tool calls) — any finished tool means
// the agent is working again, which clears a stale needs-input (mapHook: PostToolUse -> running).
const MATCHED_EVENTS: { event: HookEventName; matcher: string }[] = [
  { event: "PreToolUse", matcher: "AskUserQuestion" },
];
```

Leave the `command(...)` helper and `buildHookSettings(...)` loop bodies unchanged — they already iterate `EVENTS` (unmatched) then `MATCHED_EVENTS` (matched).

- [ ] **Step 4: Accept the new event in the hook route**

In `src/app/api/hook/route.ts`, add `"UserPromptSubmit"` to the `VALID` array (line 9):

```ts
const VALID: HookEventName[] = ["SessionStart", "UserPromptSubmit", "PermissionRequest", "Notification", "PreToolUse", "PostToolUse", "Stop", "SessionEnd"];
```

- [ ] **Step 5: Run the full suite + typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass (Task 1's handler tests, the updated `hookSettings` tests, and the rest of the suite).

- [ ] **Step 6: Commit**

```bash
git add src/server/hookSettings.ts src/app/api/hook/route.ts tests/server/hookSettings.test.ts
git commit -m "fix(mojito): wire UserPromptSubmit + all-tool PostToolUse resume signals (RIC-117)"
```

---

### Task 3: Manual verification in the app

**Files:** none (manual smoke check).

- [ ] **Step 1: Launch a real session and observe the badge**

Run the app (`npm run dev`), launch a session for a ticket, and exercise both resume paths:
- Trigger a tool-permission prompt in the session. Confirm the badge goes to **needs input**. Approve the tool. Confirm the badge returns to **running** once the agent runs the next tool (its `PostToolUse` fires).
- When the session is idle/**needs input** waiting for you, type a prompt and submit it. Confirm the badge returns to **running** immediately (`UserPromptSubmit`).
- Confirm a session that finishes its turn without advancing the stage still shows **needs input** (a `Stop` with no advance is a genuine wait — must NOT be cleared).

Expected: the "needs input" badge no longer sticks while the agent is actively working; it only persists when the session is genuinely waiting on the human.

---

## Self-Review

- **Spec coverage:** wire `UserPromptSubmit → running` (Task 1 type+mapHook, Task 2 settings+route) ✓; broaden `PostToolUse` to all tools → running (Task 2 settings; mapHook already maps it, Task 1 refreshes the comment) ✓; keep `PreToolUse` scoped to `AskUserQuestion` (Task 2 leaves it in `MATCHED_EVENTS`) ✓; `Stop`-no-advance still `needs-input` (unchanged; asserted in Task 3 and by the existing `hookHandler` test) ✓; no new `SessionState`/guard/UI change (none touched) ✓.
- **Placeholder scan:** none — every code/test step shows complete code and exact commands.
- **Type consistency:** `HookEventName` gains `"UserPromptSubmit"` in Task 1 and is used identically in `hookSettings.ts` `EVENTS` and `route.ts` `VALID` (Task 2); `mapHook` returns the `HookOutcome` shape `{ state, alert }` used by `handleHook`; `buildHookSettings` output shape (`{ hooks: Record<string, unknown[]> }` with `[{ matcher?, hooks }]` entries) matches the test's `{ matcher?: string }[]` casts.
- **Ordering:** after Task 1 the suite is green (handler + type + mapHook), `hookSettings.test.ts` still asserts the old wiring and still passes because Task 1 does not touch `hookSettings.ts`. Task 2 updates both the wiring and its tests together. Each task is independently reviewable.
