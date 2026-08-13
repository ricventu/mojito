# QA rework in the live session — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** QA rework happens by typing into the session that built the branch, instead of killing it and launching a cold replacement from a reason string.

**Architecture:** Reject is deleted end to end (server, client, prompt, docs). The work session stays alive at To QA and the human drives it directly; the result file shrinks to a bare status signal (`{"outcome": "ready-for-qa"}` / `{"outcome": "merged"}`). A launch on a To QA ticket reuses the `mojito-<ticket>-work` id so a dead session can be replaced without moving the board. The QA gate first asks git whether the branch is already merged and, when it is, offers a status-only `mark-done` verdict instead of the two approves.

**Tech Stack:** Next.js App Router (route handlers under `src/app/api`), TypeScript, vitest, React client components, tmux + git via `execFile`.

**Spec:** `docs/superpowers/specs/2026-08-13-qa-live-session-rework-design.md`

## Global Constraints

- All code artifacts in English: identifiers, comments, commit messages, test names.
- Verification gate for every task: `npx tsc --noEmit && npx vitest run`. Per-file runs during a task are fine, but the full gate must pass before the commit.
- The prompts must say **nothing** about how a session may use Linear, in either direction (RIC-184). `tests/server/prompts.test.ts` enforces this — never relax those assertions.
- Mojito never writes Linear comments. Status transitions and assignee only.
- Server logic lives under `src/server/`, browser-reachable pure logic under `src/lib/`, tests mirror the path under `tests/`.
- `src/lib/stageDefaults.ts` is browser-reachable and must not import from `src/server/statusModel.ts`; it mirrors it and a sync test ties them together. Do not add imports across that line.
- Commit after each task. Do not push; the branch is `ricventu/qa-live-session-rework`.

---

### Task 1: Result file shrinks to a status signal

**Files:**
- Modify: `src/server/sessionResult.ts`
- Test: `tests/server/sessionResult.test.ts`
- Test: `tests/server/hookHandler.test.ts:66-73` (the `blocked` case)

**Interfaces:**
- Produces: `SessionResult` = `{ outcome: "ready-for-qa" | "merged" }`. `readSessionResult(stateDir, id): SessionResult | null`, `resultPath(stateDir, id): string`, `clearSessionResult(stateDir, id): void` keep their signatures.

- [ ] **Step 1: Rewrite the failing tests**

Replace the first two cases and the `blocked` case in `tests/server/sessionResult.test.ts`:

```ts
  it("round-trips a ready-for-qa result", () => {
    const stateDir = dir();
    writeFileSync(resultPath(stateDir, "s1"), JSON.stringify({ outcome: "ready-for-qa" }));
    expect(readSessionResult(stateDir, "s1")).toEqual({ outcome: "ready-for-qa" });
  });
  it("round-trips a merged result (the merge-fix session's outcome)", () => {
    const stateDir = dir();
    writeFileSync(resultPath(stateDir, "s3"), JSON.stringify({ outcome: "merged" }));
    expect(readSessionResult(stateDir, "s3")).toEqual({ outcome: "merged" });
  });
  // The result file is a status signal, nothing more: a session with something to say says it
  // in its terminal, which stays open at To QA.
  it("drops a notes field instead of carrying it", () => {
    const stateDir = dir();
    writeFileSync(resultPath(stateDir, "s4"), JSON.stringify({ outcome: "ready-for-qa", notes: "built X" }));
    expect(readSessionResult(stateDir, "s4")).toEqual({ outcome: "ready-for-qa" });
  });
  it("returns null for the retired blocked outcome", () => {
    const stateDir = dir();
    writeFileSync(resultPath(stateDir, "s5"), JSON.stringify({ outcome: "blocked" }));
    expect(readSessionResult(stateDir, "s5")).toBeNull();
  });
```

In the last case of that file (`clear removes the file and tolerates absence`), change the written body from `{ outcome: "blocked" }` to `{ outcome: "ready-for-qa" }`.

In `tests/server/hookHandler.test.ts`, replace test `(c)` (currently `Stop + result blocked is needs-input and never calls moveToQa`) with:

```ts
  it("(c) Stop + an unreadable result is needs-input and never calls moveToQa", async () => {
    const { registry } = seed();
    const bus = new EventBus();
    const moveToQa = vi.fn(noopMoveToQa);
    await handleHook("mojito-RIC-46-in-progress", "Stop", {
      registry, bus, readResult: noResult, moveToQa, moveToDone: noopMoveToDone, clearResult: noopClearResult,
    });
    expect(moveToQa).not.toHaveBeenCalled();
    expect(registry.get("mojito-RIC-46-in-progress")?.state).toBe("needs-input");
  });
```

Also in `tests/server/hookHandler.test.ts:140`, drop the `notes` key: `readResult: () => ({ outcome: "merged" })`.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run tests/server/sessionResult.test.ts`
Expected: FAIL — `drops a notes field` gets `{outcome: "ready-for-qa", notes: "built X"}`, `returns null for the retired blocked outcome` gets an object.

- [ ] **Step 3: Implement**

Replace the type, the doc comment, and the parse in `src/server/sessionResult.ts`:

```ts
// What a ticket session reports back at the end of a round. Written by the spawned session
// (the launch prompt names this exact path); read by the Stop/SessionEnd hook. It exists only
// to move the ticket's status: "ready-for-qa" (work sessions) moves it to To QA, "merged"
// (only the merge-fix session, finishing an already-approved merge) moves it to Done. Anything
// a session wants to *say* it says in its terminal, which stays open for the human at To QA.
export interface SessionResult {
  outcome: "ready-for-qa" | "merged";
}

export function resultPath(stateDir: string, id: string): string {
  const dir = join(stateDir, "results");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return join(dir, `${id}.json`);
}

// null on missing, unreadable, malformed, or unknown-outcome file — the caller treats
// all of those as "the session reported nothing". Extra keys (e.g. a notes field from an
// older prompt) are ignored rather than rejected.
export function readSessionResult(stateDir: string, id: string): SessionResult | null {
  try {
    const parsed = JSON.parse(readFileSync(resultPath(stateDir, id), "utf8")) as { outcome?: unknown };
    if (parsed.outcome !== "ready-for-qa" && parsed.outcome !== "merged") return null;
    return { outcome: parsed.outcome };
  } catch {
    return null;
  }
}
```

`clearSessionResult` is unchanged.

- [ ] **Step 4: Run the gate**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/sessionResult.ts tests/server/sessionResult.test.ts tests/server/hookHandler.test.ts
git commit -m "refactor(result): shrink the session result file to a status signal"
```

---

### Task 2: Pin the rework loop with a regression test

The whole design rests on a session that keeps reporting after its first round. Nothing in `hookHandler.ts` changes — this task proves the existing code already supports it, and fails loudly if someone later "tidies" the state machine.

**Files:**
- Test: `tests/server/hookHandler.test.ts`

**Interfaces:**
- Consumes: `handleHook(id, event, deps)` from Task 1's unchanged module.

- [ ] **Step 1: Write the test**

Append inside `describe("handleHook — ticket sessions")`:

```ts
  // The QA rework loop: a session that reached To QA stays alive, the human types feedback into
  // it, and the next round has to move the board again. Two things make that work and both are
  // load-bearing — the session's own Write of the result file fires PostToolUse, which pulls it
  // out of "done" before Stop arrives, and clearResult runs only on success so no round
  // re-fires an old file.
  it("moves the ticket again on a later round (Stop -> PostToolUse -> Stop)", async () => {
    const { registry } = seed();
    const bus = new EventBus();
    const moveToQa = vi.fn(noopMoveToQa);
    const deps = {
      registry, bus, readResult: () => ({ outcome: "ready-for-qa" }) as const,
      moveToQa, moveToDone: noopMoveToDone, clearResult: noopClearResult,
    };
    await handleHook("mojito-RIC-46-in-progress", "Stop", deps);
    expect(registry.get("mojito-RIC-46-in-progress")?.state).toBe("done");

    // The human replies; the session starts working again.
    await handleHook("mojito-RIC-46-in-progress", "PostToolUse", deps);
    expect(registry.get("mojito-RIC-46-in-progress")?.state).toBe("running");

    await handleHook("mojito-RIC-46-in-progress", "Stop", deps);
    expect(moveToQa).toHaveBeenCalledTimes(2);
  });
```

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/server/hookHandler.test.ts`
Expected: PASS (this pins current behavior). If it FAILS, stop and report — the design assumption in the spec's "Failure modes" is wrong and the plan needs revisiting before anything else lands.

- [ ] **Step 3: Commit**

```bash
git add tests/server/hookHandler.test.ts
git commit -m "test(hook): pin the QA rework loop across rounds"
```

---

### Task 3: Work prompt — cut the method, make the asset paragraph conditional

**Files:**
- Modify: `src/server/prompts/work.ts`
- Modify: `src/server/prompts.ts`
- Modify: `src/server/launch.ts:93-97` (the `buildWorkPrompt` call)
- Test: `tests/server/prompts.test.ts`
- Test: `tests/server/launch.test.ts` (only if a case asserts prompt text)

**Interfaces:**
- Produces: `WorkPromptVars = PromptVars & { hasAssets: boolean }`; `buildWorkPrompt(vars: WorkPromptVars): string`.
- Consumes: `LaunchRequest.assets` / `LaunchRequest.attachments` from `src/server/launch.ts` (unchanged in this task).

- [ ] **Step 1: Write the failing tests**

In `tests/server/prompts.test.ts`, give the shared `vars` the new field and split the asset assertions into a pair. Change line 4 to:

```ts
const vars = { ticket: "RIC-46", contextPath: "/state/context/s1.json", resultPath: "/state/results/s1.json", hasAssets: true };
```

`fixVars` spreads `vars`, so strip the extra key where the merge-fix builder is called: change line 5 to

```ts
const { hasAssets: _hasAssets, ...baseVars } = vars;
const fixVars = { ...baseVars, mergeMode: "local" as const, blocker: "CONFLICT (content): src/a.ts" };
```

Update the Linear mention-count case (`names Linear only as the source of the data Mojito already read`) — the third mention lives in the asset paragraph, so it is conditional too:

```ts
    expect(work).toContain("because their URLs sit behind Linear's file auth");
    expect(work.match(/Linear/g)).toHaveLength(3);
    // Without assets the paragraph is gone, and with it its single Linear mention.
    expect(flat(buildWorkPrompt({ ...vars, hasAssets: false })).match(/Linear/g)).toHaveLength(2);
```

Replace the `tells the work session to read the assets Mojito downloaded` case with the pair:

```ts
  it("tells the work session to read the assets Mojito downloaded", () => {
    const p = buildWorkPrompt({ ...vars, hasAssets: true });
    expect(p).toContain("localPath");
    expect(p).toContain("Read tool");
    expect(p).toContain("attachments");
  });

  // Most tickets carry nothing. Six lines about files that do not exist are pure cost, and
  // they invite the session to go looking for context keys it does not have.
  it("omits the asset paragraph — and leaves no gap — when there is nothing to read", () => {
    const p = buildWorkPrompt({ ...vars, hasAssets: false });
    expect(p).not.toContain("localPath");
    expect(p).not.toContain("attachments");
    expect(p).not.toContain("\n\n\n");
  });

  // The method is the session's business; the prompt carries only what a session cannot infer.
  it("carries no rework branch, no blocked outcome, and no notes field", () => {
    const p = buildWorkPrompt(vars);
    expect(p).not.toContain("rejectReason");
    expect(p).not.toContain("blocked");
    expect(p).not.toContain("notes");
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/server/prompts.test.ts`
Expected: FAIL — `buildWorkPrompt` rejects the extra property under TS and the new cases find `rejectReason` / `notes` in the template.

- [ ] **Step 3: Rewrite the work prompt template**

Replace the whole body of `src/server/prompts/work.ts`:

```ts
// The work-phase prompt for a ticket session. It carries only what a session cannot work out
// for itself: Mojito's two channels (the context file it reads, the result file it writes) and
// the worktree convention. How to take the ticket from there — which skills, how much design up
// front — is a session-level decision, exactly as in a hand-started session.
//
// The prompt says NOTHING about how the session may use Linear, deliberately (RIC-184).
// It used to ban Linear outright, which killed the follow-up tickets that surface
// mid-session; a permission grant was tried instead and was worse, since it had the
// session opening tickets without asking. Neither is needed: with no instruction, the
// session behaves like any other — it proposes, the user confirms. Do not add one back.
export const WORK_PROMPT_TEMPLATE = `You are working Linear ticket {{TICKET}} end to end in this repository.

First read the JSON session context at {{CONTEXT_PATH}}: identifier, statusName,
title, project, labels, and description. Mojito already read all of that from Linear,
so you never have to spend tokens re-reading it.

{{ASSETS_PARAGRAPH}}Isolation: create (or reuse) a worktree and branch named after {{TICKET}} via
the superpowers:using-git-worktrees skill. If the current directory already is
that worktree, stay in it.

Result file — REQUIRED. As the very last action of a round, write {{RESULT_PATH}}
with exactly this JSON object:
  {"outcome": "ready-for-qa"}
It is the only signal Mojito has to move {{TICKET}} to To QA. Your session stays
alive afterwards: when the human comes back with QA feedback, work it and write the
file again at the end of that round.`;

// Interpolated only when the launch actually downloaded something (see buildWorkPrompt).
// Ends with a blank line so the template reads the same with or without it.
export const ASSETS_PARAGRAPH = `The context also carries \`assets\` (each \`{url, localPath}\`) and \`attachments\`
(each \`{title, url, localPath?}\`) — Mojito already downloaded those files for you
because their URLs sit behind Linear's file auth. Before you start, open every
\`localPath\` you can with the Read tool. A \`localPath\` ending in \`.bin\` is a content
type Mojito could not identify; treat it only as a file you know exists, not one you
can Read. An attachment with no \`localPath\` is a plain link, informational only.

`;
```

- [ ] **Step 4: Teach the builder the flag**

In `src/server/prompts.ts`, change the import line and the work builder:

```ts
import { WORK_PROMPT_TEMPLATE, ASSETS_PARAGRAPH } from "./prompts/work.js";
```

```ts
export interface WorkPromptVars extends PromptVars {
  // Whether the launch context actually carries assets/attachments. False drops the whole
  // paragraph describing them rather than telling the session about keys it will not find.
  hasAssets: boolean;
}

export function buildWorkPrompt(vars: WorkPromptVars): string {
  const { hasAssets, ...base } = vars;
  return render(WORK_PROMPT_TEMPLATE, base)
    .replaceAll("{{ASSETS_PARAGRAPH}}", hasAssets ? ASSETS_PARAGRAPH : "");
}
```

- [ ] **Step 5: Pass the flag at the call site**

In `src/server/launch.ts`, inside `launchSession`, replace the prompt construction:

```ts
  const command = buildClaudeCommand(req, settingsPath, buildWorkPrompt({
    ticket: req.ticket,
    contextPath,
    resultPath: resultPath(deps.stateDir, id),
    // Same condition that decides whether the keys land in the context file, so prompt and
    // context can never disagree about what the session will find.
    hasAssets: Boolean(req.assets?.length || req.attachments?.length),
  }));
```

- [ ] **Step 6: Run the gate**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS. If a `tests/server/launch.test.ts` case asserts prompt text that no longer exists, update that assertion to match the new template — do not re-add the removed text.

- [ ] **Step 7: Commit**

```bash
git add src/server/prompts/work.ts src/server/prompts.ts src/server/launch.ts tests/server/prompts.test.ts tests/server/launch.test.ts
git commit -m "feat(prompt): cut the work prompt to Mojito's channels and gate the asset paragraph"
```

---

### Task 4: Merge-fix prompt drops `notes` and `blocked`

**Files:**
- Modify: `src/server/prompts/conflict.ts:33-36`
- Test: `tests/server/prompts.test.ts`

**Interfaces:**
- Consumes: `SessionResult` from Task 1 — `merged` is the only outcome this prompt may write.

- [ ] **Step 1: Write the failing test**

Add to `tests/server/prompts.test.ts`:

```ts
  it("gives the merge-fix session the same bare result contract", () => {
    const p = buildMergeFixPrompt(fixVars);
    expect(p).toContain('{"outcome": "merged"}');
    expect(p).not.toContain("notes");
    expect(p).not.toContain("blocked");
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/server/prompts.test.ts -t "bare result contract"`
Expected: FAIL — the template still carries `"notes"` and a `blocked` variant.

- [ ] **Step 3: Implement**

In `src/server/prompts/conflict.ts`, replace the closing paragraph of `MERGE_FIX_PROMPT_TEMPLATE`:

```
Result file — REQUIRED. As the very last action, write {{RESULT_PATH}} with
exactly this JSON object: {"outcome": "merged"} once step 5 is done. It is the
only signal Mojito has to move {{TICKET}} to Done. If the merge cannot be
completed safely, do not write the file — say so and stop; your session stays
open for the human.
```

Update the header comment's last clause to match: the session `reports "merged" through the result file` stays accurate, so only the sentence describing a blocked outcome (if any) needs removing.

- [ ] **Step 4: Run the gate**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/prompts/conflict.ts tests/server/prompts.test.ts
git commit -m "feat(prompt): drop notes and blocked from the merge-fix contract"
```

---

### Task 5: Remove reject — server

**Files:**
- Modify: `src/server/qaVerdict.ts`
- Modify: `src/server/ticketVerdict.ts`
- Modify: `src/app/api/tickets/[id]/verdict/route.ts`
- Modify: `src/server/launch.ts:17-29, 82-91`
- Modify: `src/server/launchContext.ts`
- Test: `tests/server/qaVerdict.test.ts`, `tests/server/ticketVerdict.test.ts`, `tests/server/verdictRoute.test.ts`, `tests/server/launchContext.test.ts`, `tests/server/launch.test.ts`

**Interfaces:**
- Produces: `QaArg = "approve-local" | "approve-mr"` (Task 10 adds a third); `QaVerdictDeps = { merge, setIssueStatus, launchMergeFix }`; `resolveTicketVerdict({ ticket, arg }, deps)` — no `reason` anywhere.
- Consumes: nothing new.

- [ ] **Step 1: Rewrite the tests**

`tests/server/qaVerdict.test.ts`: delete the whole `describe("resolveQaVerdict reject")` block; drop `launchRework` from the `deps()` factory and from the two `expect(d.launchRework).not.toHaveBeenCalled()` assertions in the approve block. Update the arg-set case:

```ts
describe("QA_ARGS", () => {
  it("is the exact accepted verdict set", () => {
    expect([...QA_ARGS]).toEqual(["approve-local", "approve-mr"]);
  });
});
```

Add, so reject's removal is asserted rather than merely absent:

```ts
  it("no longer exposes a rework dependency", async () => {
    const d = deps();
    await resolveQaVerdict({ ticket: "RIC-110", arg: "approve-local" }, d);
    expect(Object.keys(d)).toEqual(["merge", "setIssueStatus", "launchMergeFix"]);
  });
```

`tests/server/ticketVerdict.test.ts`: delete the `reject passes the reason through…` case. Change the first case's assertion to `expect(d.resolveVerdict).toHaveBeenCalledWith({ ticket: "RIC-110", arg: "approve-local" })`. Change the `maps QaVerdictError to 400` case to drive it through a valid arg:

```ts
  it("maps QaVerdictError to 400 and skips supersede", async () => {
    const d = deps({ resolveVerdict: vi.fn(async () => { throw new QaVerdictError("no worktree for ticket"); }) });
    const res = await resolveTicketVerdict({ ticket: "RIC-110", arg: "approve-local" }, d);
    expect(res).toEqual({ ok: false, code: 400, error: "no worktree for ticket" });
    expect(d.supersedeStaleSession).not.toHaveBeenCalled();
  });
```

Add:

```ts
  it("rejects the retired 'reject' arg", async () => {
    const d = deps();
    const res = await resolveTicketVerdict({ ticket: "RIC-110", arg: "reject" }, d);
    expect(res).toEqual({ ok: false, code: 400, error: "invalid arg" });
    expect(d.getIssueStatus).not.toHaveBeenCalled();
  });
```

`tests/server/verdictRoute.test.ts`: delete these cases by name — `reject moves the ticket to In Progress and launches rework carrying the reason`, `reject launches the rework session BEFORE moving the board, so a failed launch keeps To QA`, `a failed rework launch leaves the board untouched`, `reject never supersedes the rework session it just launched`, `launches rework with an empty description when Linear cannot be read`, `hands the rework session the ticket's downloaded assets`. Add one case in their place, following the file's existing mock/`POST` helper style:

```ts
  it("400s a reject body and touches neither git nor Linear", async () => {
    const res = await POST(req({ arg: "reject", reason: "layout broken" }), params("RIC-110"));
    expect(res.status).toBe(400);
    expect(h.setIssueStatus).not.toHaveBeenCalled();
    expect(h.mergeTicketBranch).not.toHaveBeenCalled();
    expect(h.launchSession).not.toHaveBeenCalled();
  });
```

Adapt the helper names (`req`, `params`, `h`) to whatever that file already uses.

`tests/server/launchContext.test.ts`: delete `includes rejectReason when given (QA rework)`.
`tests/server/launch.test.ts`: delete `passes rejectReason through to the context file when present (QA rework)`.

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/server/qaVerdict.test.ts tests/server/ticketVerdict.test.ts`
Expected: FAIL — `QA_ARGS` still contains `reject`, and the deps-key assertion still sees `launchRework`.

- [ ] **Step 3: Implement — `src/server/qaVerdict.ts`**

```ts
export type QaArg = "approve-local" | "approve-mr";
export const QA_ARGS: readonly QaArg[] = ["approve-local", "approve-mr"];

export class QaVerdictError extends Error {}

export interface QaVerdictDeps {
  // May throw QaVerdictError for unfixable preconditions (no worktree, unresolvable main
  // checkout); any outcome it RETURNS as conflict/error is one a merge-fix session can work on.
  merge: (mode: MergeMode) => Promise<MergeOutcome>;
  setIssueStatus: (ticket: string, target: string) => Promise<void>;
  // Launches the merge-fix session (it completes the approved merge itself and reports
  // "merged", which moves the ticket to Done). Returns the session's tmux id so the
  // caller can offer to open it.
  launchMergeFix: (detail: string, mode: MergeMode) => Promise<string>;
}

export type QaVerdictResult =
  | { done: "merged"; commit: string }
  | { done: "mr-created"; url: string }
  | { done: "fix-session"; sessionId: string; detail: string };

/**
 * Resolve a To QA verdict. Approve runs the server-side merge (zero tokens on the clean
 * path) and only launches a session when that merge hits a conflict. There is no reject:
 * a ticket that fails QA is reworked by talking to the session that built it, which is
 * still alive in tmux — Mojito is not in that loop at all.
 */
export async function resolveQaVerdict(
  input: { ticket: string; arg: QaArg },
  deps: QaVerdictDeps,
): Promise<QaVerdictResult> {
  const { ticket, arg } = input;
  const mode: MergeMode = arg === "approve-local" ? "local" : "mr";
  const outcome = await deps.merge(mode);
  switch (outcome.status) {
    case "merged":
      await deps.setIssueStatus(ticket, "Done");
      return { done: "merged", commit: outcome.commit };
    case "mr-created":
      await deps.setIssueStatus(ticket, "Done");
      return { done: "mr-created", url: outcome.url };
    case "conflict":
    case "error": {
      // The merge is approved but could not complete on its own (conflict, diverged
      // default branch, dirty worktree, ...). The ticket stays at To QA and the
      // merge-fix session finishes the job — its "merged" result moves it to Done.
      const sessionId = await deps.launchMergeFix(outcome.detail, mode);
      return { done: "fix-session", sessionId, detail: outcome.detail };
    }
  }
}
```

- [ ] **Step 4: Implement — `src/server/ticketVerdict.ts`**

Drop `reason` from the input type, from `resolveVerdict`'s signature, and from the call:

```ts
export interface TicketVerdictDeps {
  getIssueStatus: (ticket: string) => Promise<string>;
  resolveVerdict: (input: { ticket: string; arg: QaArg }) => Promise<QaVerdictResult>;
  supersedeStaleSession: (ticket: string) => Promise<void>;
}
```

```ts
export async function resolveTicketVerdict(
  input: { ticket: string; arg: string },
  deps: TicketVerdictDeps,
): Promise<VerdictResult> {
  const { ticket, arg } = input;
  if (!QA_ARGS.includes(arg as QaArg)) return { ok: false, code: 400, error: "invalid arg" };

  const status = await deps.getIssueStatus(ticket);
  if (status !== "To QA") return { ok: false, code: 409, error: "ticket is not at To QA" };

  let result: QaVerdictResult;
  try {
    result = await deps.resolveVerdict({ ticket, arg: arg as QaArg });
  } catch (e) {
    const error = e instanceof Error ? e.message : "verdict failed";
    return { ok: false, code: e instanceof QaVerdictError ? 400 : 422, error };
  }

  await deps.supersedeStaleSession(ticket);
  return { ok: true, result };
}
```

- [ ] **Step 5: Implement — the verdict route**

In `src/app/api/tickets/[id]/verdict/route.ts`: delete the `reason` body field, the `workSessionRelaunched` flag and its comment, the entire `launchRework` closure, and the guard line `if (workSessionRelaunched) return;` inside `supersedeStaleSession`. Drop the now-unused imports: `prepareTicketAssets`, `MAX_ASSET_BYTES`, `downloadLinearAsset`, `launchSession`. Keep `getIssueContent` and the `content()` helper — `launchMergeFix` still uses the description. The `resolveTicketVerdict` call loses its `reason`:

```ts
  const result = await resolveTicketVerdict(
    { ticket: id, arg },
    {
      getIssueStatus: (t) => getIssueStatus(cfg.linearApiKey, t),
      resolveVerdict: (i) => resolveQaVerdict(i, { /* merge, setIssueStatus, launchMergeFix as before */ }),
      supersedeStaleSession: async (t) => {
        const sid = tmuxName(t, "In Progress");
        if (registry.get(sid)) await supersedeSession(sid, { closeSession, registry });
      },
    },
  );
```

- [ ] **Step 6: Implement — launch context**

`src/server/launch.ts`: delete `rejectReason?: string;` from `LaunchRequest` and the `...(req.rejectReason ? { rejectReason: req.rejectReason } : {})` line from the `writeLaunchContext` call.

`src/server/launchContext.ts`: delete the `rejectReason?: string;` field, and end the doc comment at the description fetch — the "and, on QA rework, see why the ticket bounced back" clause goes:

```ts
/**
 * Write the per-session launch context the spawned session itself reads (the file's
 * path is embedded directly in the Mojito-built work prompt — no env var involved) so
 * it can skip a Linear `get_issue`/description fetch. Returns the file path so the
 * caller can embed it in the prompt.
 */
```

- [ ] **Step 7: Run the gate**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS. TypeScript will point at any remaining `reason` / `rejectReason` / `rework-session` reference; delete rather than adapt each one.

- [ ] **Step 8: Commit**

```bash
git add src/server tests/server src/app/api/tickets
git commit -m "feat(qa): remove reject from the server verdict path"
```

---

### Task 6: Remove reject — client

**Files:**
- Modify: `src/components/QaVerdictButtons.tsx`
- Modify: `src/components/LaunchSheet.tsx:35, 59-88, 252`
- Modify: `src/lib/verdictOutcome.ts`
- Test: `tests/lib/verdictOutcome.test.ts`

**Interfaces:**
- Produces: `QaVerdictButtons` props `{ pending: "approve-local" | "approve-mr" | null; onApprove }` (Task 11 extends this).
- Consumes: `QaVerdictResult` from Task 5.

- [ ] **Step 1: Update the failing test**

In `tests/lib/verdictOutcome.test.ts`, replace the `a rework-session result` row with:

```ts
    ["the retired rework-session value", { done: "rework-session" }, false],
```

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/lib/verdictOutcome.test.ts`
Expected: PASS. `holdsSheetOpen` already answers `false` for any unrecognised `done`, so a retired value needs no code change — the renamed row documents that reject's result is now exactly as foreign as `conflict-session`, the row above it.

- [ ] **Step 3: Implement — `verdictOutcome.ts`**

No type change is needed: `HeldOutcome` is an `Extract` over `mr-created | fix-session`, both of which survive Task 5. Update only the comment, so it stops implying reject exists:

```ts
// The two verdict outcomes worth holding the sheet open for: the ones that carry
// information the user cannot get anywhere else (the MR URL, and the fact that the
// merge could not complete on its own and a fix session took over). Anything else —
// including a body from a server that predates or postdates this client — closes the
// sheet, so a version skew degrades to the old behaviour instead of a blank panel.
```

- [ ] **Step 4: Implement — `QaVerdictButtons.tsx`**

```tsx
"use client";

// Approve is two buttons, not one: the merge is done server-side and the user chooses how
// it lands — a local fast-forward onto the default branch, or a pushed branch + MR/PR.
// There is no reject: a ticket that fails QA is reworked by typing into the session that
// built it, which is still alive.
export default function QaVerdictButtons(
  { pending, onApprove }:
  { pending: "approve-local" | "approve-mr" | null;
    onApprove: (arg: "approve-local" | "approve-mr") => void },
) {
  // The server-side merge takes 10s+: while a verdict is in flight, both buttons are
  // disabled and the one that was clicked says what it is doing.
  const busy = pending !== null;

  return (
    <div className="btns">
      <button className="btn primary" disabled={busy} onClick={() => onApprove("approve-local")}>
        {pending === "approve-local" ? "Merging…" : "Approve · merge"}
      </button>
      <button className="btn primary" disabled={busy} onClick={() => onApprove("approve-mr")}>
        {pending === "approve-mr" ? "Opening MR…" : "Approve · MR"}
      </button>
    </div>
  );
}
```

The `useState` import goes with the `rejecting`/`reason` state.

- [ ] **Step 5: Implement — `LaunchSheet.tsx`**

- Line 35: `const [verdictPending, setVerdictPending] = useState<"approve-local" | "approve-mr" | null>(null);`
- `submitVerdict`: drop the `reason` parameter and the conditional body key, and update the comment that says only reject spawns a session:

```tsx
  // The To QA verdict is resolved server-side: approve merges (or opens an MR) with no
  // session at all, and only a merge conflict spawns one. projectName and title are sent
  // because the server needs them to locate the worktree and to seed a fix session.
  const submitVerdict = async (arg: "approve-local" | "approve-mr") => {
    setErr(null);
    setVerdictPending(arg);
    try {
      const res = await apiFetch(token, `/api/tickets/${ticket.identifier}/verdict`, {
        method: "POST",
        body: JSON.stringify({ arg, projectName: ticket.project, title: ticket.title }),
      });
```

(the rest of the function body is unchanged)

- Line 252: `<QaVerdictButtons pending={verdictPending} onApprove={(a) => submitVerdict(a)} />`

- [ ] **Step 6: Run the gate**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components src/lib tests/lib
git commit -m "feat(qa): drop the reject button and its reason field"
```

---

### Task 7: A launch at To QA reuses the work session id

**Files:**
- Modify: `src/server/sessionKey.ts:22-30`
- Test: `tests/server/sessionKey.test.ts`

**Interfaces:**
- Produces: `tmuxName(ticket, "To QA") === "mojito-<ticket>-work"`.

- [ ] **Step 1: Write the failing test**

Add to `tests/server/sessionKey.test.ts`, inside the `tmuxName` describe:

```ts
  // A ticket parks at To QA while its work session stays alive. If that session dies, the
  // relaunch has to take the id its predecessor had, or the duplicate guard and the
  // "open running session" lookup would each see a different session for one ticket.
  it("gives a To QA launch the same id as the work states", () => {
    expect(tmuxName("RIC-46", "To QA")).toBe("mojito-RIC-46-work");
    expect(tmuxName("RIC-46", "In Progress")).toBe("mojito-RIC-46-work");
  });

  it("still gives the conflict session an id of its own", () => {
    expect(conflictSessionName("RIC-46")).toBe("mojito-RIC-46-conflict");
    expect(conflictSessionName("RIC-46")).not.toBe(tmuxName("RIC-46", "To QA"));
  });
```

Import `conflictSessionName` alongside `tmuxName` if the file does not already.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/server/sessionKey.test.ts`
Expected: FAIL — `expected 'mojito-RIC-46-to-qa' to be 'mojito-RIC-46-work'`.

- [ ] **Step 3: Implement**

In `src/server/sessionKey.ts`:

```ts
import { WORK_STATES, GATE_STATES } from "./statusModel.js";
```

```ts
// One id covers every status a work session can be launched from. Two reasons, both
// load-bearing: a launch-time board move (Backlog/Todo -> In Progress) must not change the
// session's tmux name mid-flight, and a session relaunched while the ticket sits at To QA
// (its predecessor died) must take the id that predecessor had. Otherwise the duplicate
// guard and the "open running session" lookup each see a different session for one ticket.
const WORK_ID_STATES = [...WORK_STATES, ...GATE_STATES];

export function tmuxName(ticket: string, status: string): string {
  validateTicket(ticket);
  const slug = WORK_ID_STATES.includes(status) ? "work" : statusSlug(status);
  return `mojito-${ticket}-${slug}`;
}
```

- [ ] **Step 4: Run the gate**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS. If a launch or route test asserts `mojito-<t>-to-qa`, update it — that id is retired.

- [ ] **Step 5: Commit**

```bash
git add src/server/sessionKey.ts tests/server/sessionKey.test.ts
git commit -m "feat(session): give a To QA launch the work session id"
```

---

### Task 8: `isAlreadyMerged`

**Files:**
- Modify: `src/server/merge.ts`
- Test: `tests/server/merge.test.ts`

**Interfaces:**
- Produces: `isAlreadyMerged(input: { worktree: string; repoRoot: string }, run?: GitRun): Promise<boolean>`.
- Consumes: `GitRun`, `detectDefaultBranch` from the same module.

- [ ] **Step 1: Write the failing tests**

Add to `tests/server/merge.test.ts`. These use a scripted `GitRun` (no real git), so put them in a plain `describe`, outside the `run` (git-gated) block:

```ts
// A scripted GitRun: `answers` maps the leading git subcommand+args (joined by a space) to
// stdout; anything listed in `fails` throws, which is how git signals a false --is-ancestor.
function scriptedRun(answers: Record<string, string>, fails: string[] = []): GitRun {
  return async (args) => {
    const key = args.join(" ");
    if (fails.includes(key)) throw new Error(`exit 1: git ${key}`);
    return { stdout: answers[key] ?? "", stderr: "" };
  };
}

const BASE = {
  "rev-parse --abbrev-ref HEAD": "ric-46",
  remote: "origin",
  "fetch --prune": "",
  "symbolic-ref --short refs/remotes/origin/HEAD": "origin/main",
};

describe("isAlreadyMerged", () => {
  it("is true when the branch is an ancestor of the default branch", async () => {
    const merged = await isAlreadyMerged(
      { worktree: "/w", repoRoot: "/r" },
      scriptedRun({ ...BASE }),
    );
    expect(merged).toBe(true);
  });

  // A squash-merge rewrites the commits, so --is-ancestor says no; git cherry still
  // recognises every patch as already upstream.
  it("is true for a squash-merged branch (no + lines from git cherry)", async () => {
    const merged = await isAlreadyMerged(
      { worktree: "/w", repoRoot: "/r" },
      scriptedRun({ ...BASE, "cherry origin/main ric-46": "- abc123\n- def456\n" },
        ["merge-base --is-ancestor ric-46 origin/main"]),
    );
    expect(merged).toBe(true);
  });

  it("is false when git cherry still has commits to apply", async () => {
    const merged = await isAlreadyMerged(
      { worktree: "/w", repoRoot: "/r" },
      scriptedRun({ ...BASE, "cherry origin/main ric-46": "- abc123\n+ def456\n" },
        ["merge-base --is-ancestor ric-46 origin/main"]),
    );
    expect(merged).toBe(false);
  });

  it("is false on a detached HEAD", async () => {
    const merged = await isAlreadyMerged(
      { worktree: "/w", repoRoot: "/r" },
      scriptedRun({ ...BASE, "rev-parse --abbrev-ref HEAD": "HEAD" }),
    );
    expect(merged).toBe(false);
  });

  // A broken check must degrade to "not merged", which is the path that still works.
  it("is false when git fails outright", async () => {
    const merged = await isAlreadyMerged(
      { worktree: "/w", repoRoot: "/r" },
      scriptedRun({}, ["rev-parse --abbrev-ref HEAD"]),
    );
    expect(merged).toBe(false);
  });

  it("compares against the local default branch when there is no remote", async () => {
    const seen: string[][] = [];
    const run: GitRun = async (args) => {
      seen.push(args);
      if (args[0] === "remote") return { stdout: "", stderr: "" };
      if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") return { stdout: "ric-46", stderr: "" };
      if (args[0] === "symbolic-ref") throw new Error("no origin/HEAD");
      return { stdout: "", stderr: "" };
    };
    expect(await isAlreadyMerged({ worktree: "/w", repoRoot: "/r" }, run)).toBe(true);
    expect(seen.some((a) => a[0] === "fetch")).toBe(false);
    expect(seen).toContainEqual(["merge-base", "--is-ancestor", "ric-46", "main"]);
  });
});
```

Add `isAlreadyMerged` to the module's import at the top of the test file.

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/server/merge.test.ts`
Expected: FAIL — `isAlreadyMerged is not a function`.

- [ ] **Step 3: Implement**

Append to `src/server/merge.ts`:

```ts
/**
 * Whether the worktree's branch is already in the default branch — someone merged it
 * outside Mojito (a PR on the forge, a squash from the web UI, a local merge). Read-only:
 * it fetches remote refs and inspects history, and never rebases, checks out, or writes.
 *
 * Two checks, because a squash-merge leaves no ancestry: `merge-base --is-ancestor` catches
 * a real merge or rebase-merge, and `git cherry` catches the squash — it prints `+` only
 * for commits with no equivalent upstream, so no `+` line means everything already landed.
 *
 * Answers false on any git failure. This gates a UI affordance; a broken check must fall
 * back to the ordinary approve path rather than block the gate. Note a branch with no
 * commits of its own also answers true — there is genuinely nothing to merge.
 */
export async function isAlreadyMerged(
  input: { worktree: string; repoRoot: string },
  run: GitRun = defaultRun,
): Promise<boolean> {
  const { worktree, repoRoot } = input;
  try {
    const branch = (await run(["rev-parse", "--abbrev-ref", "HEAD"], worktree)).stdout.trim();
    if (!branch || branch === "HEAD") return false;

    const hasRemote = (await run(["remote"], worktree)).stdout.trim().length > 0;
    // The manual merge usually happened on the remote, so a stale origin ref would answer
    // "not merged" in exactly the case this exists for.
    if (hasRemote) await run(["fetch", "--prune"], worktree);
    const def = await detectDefaultBranch(repoRoot, run);
    const target = hasRemote ? `origin/${def}` : def;

    try {
      await run(["merge-base", "--is-ancestor", branch, target], worktree);
      return true;
    } catch {
      /* not an ancestor — it may still have been squash-merged */
    }
    const { stdout } = await run(["cherry", target, branch], worktree);
    return !stdout.split("\n").some((line) => line.startsWith("+"));
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run the gate**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/merge.ts tests/server/merge.test.ts
git commit -m "feat(merge): detect a branch that is already in the default branch"
```

---

### Task 9: Shared ticket dirs + the `merge-state` endpoint

**Files:**
- Create: `src/server/ticketDirs.ts`
- Create: `src/app/api/tickets/[id]/merge-state/route.ts`
- Modify: `src/app/api/tickets/[id]/verdict/route.ts` (use the shared resolver)
- Test: `tests/server/mergeStateRoute.test.ts`

**Interfaces:**
- Produces: `resolveTicketDirs(projectsPath: string, ticket: string, projectName: string | null): Promise<{ worktree: string | null; repoRoot: string | null }>`; `GET /api/tickets/<id>/merge-state?projectName=<name>` → `{ merged: boolean }`.
- Consumes: `isAlreadyMerged` (Task 8).

- [ ] **Step 1: Write the failing test**

Create `tests/server/mergeStateRoute.test.ts`, mirroring the mocking style of `tests/server/verdictRoute.test.ts` (read it first and match its `vi.mock` setup):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  isAlreadyMerged: vi.fn(async () => true),
  resolveTicketDirs: vi.fn(async () => ({ worktree: "/repo/.worktrees/RIC-110", repoRoot: "/repo" })),
}));

vi.mock("@/server/merge", () => ({ isAlreadyMerged: h.isAlreadyMerged }));
vi.mock("@/server/ticketDirs", () => ({ resolveTicketDirs: h.resolveTicketDirs }));
vi.mock("@/server/app", () => ({
  getConfig: () => ({ token: "t", projectsPath: "/cfg/projects.json" }),
}));
vi.mock("@/server/auth", () => ({ tokenFromHeaders: (_h: Headers, t: string) => t === "t" }));

import { GET } from "@/app/api/tickets/[id]/merge-state/route";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (qs = "?projectName=mojito") =>
  new Request(`http://localhost/api/tickets/RIC-110/merge-state${qs}`, { headers: { authorization: "Bearer t" } });

beforeEach(() => {
  h.isAlreadyMerged.mockClear();
  h.resolveTicketDirs.mockClear();
  h.resolveTicketDirs.mockResolvedValue({ worktree: "/repo/.worktrees/RIC-110", repoRoot: "/repo" });
});

describe("GET /api/tickets/[id]/merge-state", () => {
  it("answers the git check", async () => {
    const res = await GET(req(), params("RIC-110"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ merged: true });
    expect(h.isAlreadyMerged).toHaveBeenCalledWith({ worktree: "/repo/.worktrees/RIC-110", repoRoot: "/repo" });
  });

  it("answers false without touching git when the ticket has no worktree", async () => {
    h.resolveTicketDirs.mockResolvedValue({ worktree: null, repoRoot: "/repo" });
    const res = await GET(req(), params("RIC-110"));
    expect(await res.json()).toEqual({ merged: false });
    expect(h.isAlreadyMerged).not.toHaveBeenCalled();
  });

  // The worktree IS the main checkout: there is no separate branch to compare.
  it("answers false when the worktree and the repo root are the same path", async () => {
    h.resolveTicketDirs.mockResolvedValue({ worktree: "/repo", repoRoot: "/repo" });
    const res = await GET(req(), params("RIC-110"));
    expect(await res.json()).toEqual({ merged: false });
    expect(h.isAlreadyMerged).not.toHaveBeenCalled();
  });

  it("401s without a token", async () => {
    const bare = new Request("http://localhost/api/tickets/RIC-110/merge-state");
    expect((await GET(bare, params("RIC-110"))).status).toBe(401);
  });

  it("400s an invalid ticket id", async () => {
    expect((await GET(req(), params("nope"))).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/server/mergeStateRoute.test.ts`
Expected: FAIL — the route module does not exist.

- [ ] **Step 3: Implement — `src/server/ticketDirs.ts`**

```ts
import { loadProjectMap, resolvePathForProject } from "./projects.js";
import { repoRootFromWorktree } from "./merge.js";
import { resolveTicketWorktree } from "./ticketCwd.js";

export interface TicketDirs {
  worktree: string | null;
  repoRoot: string | null;
}

/**
 * Both sides of a ticket's git state: the worktree holding its branch, and the project's
 * main checkout that a local fast-forward lands in. The main checkout comes from the project
 * map when the project is mapped, and otherwise from git itself (repoRootFromWorktree) —
 * asking the worktree beats guessing, and resolveTicketCwd would just hand back the worktree.
 */
export async function resolveTicketDirs(
  projectsPath: string,
  ticket: string,
  projectName: string | null,
): Promise<TicketDirs> {
  const worktree = resolveTicketWorktree(projectsPath, ticket, projectName);
  const mapped = projectName ? resolvePathForProject(loadProjectMap(projectsPath), projectName) : null;
  return { worktree, repoRoot: mapped ?? (worktree ? await repoRootFromWorktree(worktree) : null) };
}
```

- [ ] **Step 4: Implement — the route**

Create `src/app/api/tickets/[id]/merge-state/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getConfig } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { isAlreadyMerged } from "@/server/merge";
import { resolveTicketDirs } from "@/server/ticketDirs";
import { validateTicket } from "@/server/sessionKey";

/**
 * Whether the ticket's branch is already in the default branch. Read by the QA gate before
 * it offers a verdict: a branch merged outside Mojito needs no merge, only a status write.
 * Read-only and best-effort — anything it cannot determine answers false, which leaves the
 * ordinary approve path in place.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const { id } = await params;
  try { validateTicket(id); } catch { return new NextResponse("invalid ticket", { status: 400 }); }
  const projectName = new URL(req.url).searchParams.get("projectName") || null;

  const { worktree, repoRoot } = await resolveTicketDirs(cfg.projectsPath, id, projectName);
  // No worktree means no branch of its own; worktree === repoRoot means the "branch" is the
  // main checkout. Neither is a merge question, so neither pays for a git call.
  if (!worktree || !repoRoot || worktree === repoRoot) return NextResponse.json({ merged: false });
  return NextResponse.json({ merged: await isAlreadyMerged({ worktree, repoRoot }) });
}
```

- [ ] **Step 5: Use the shared resolver in the verdict route**

In `src/app/api/tickets/[id]/verdict/route.ts`, replace the inline `resolveDirs` closure with the shared function, keeping the laziness:

```ts
import { resolveTicketDirs } from "@/server/ticketDirs";
```

```ts
  const resolveDirs = () => resolveTicketDirs(cfg.projectsPath, id, projectName);
```

Drop the imports that become unused (`loadProjectMap`, `resolvePathForProject`, `resolveTicketWorktree`, and `repoRootFromWorktree` if nothing else in the file uses it).

- [ ] **Step 6: Run the gate**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/ticketDirs.ts src/app/api/tickets tests/server/mergeStateRoute.test.ts
git commit -m "feat(qa): expose whether a ticket branch is already merged"
```

---

### Task 10: The `mark-done` verdict

**Files:**
- Modify: `src/server/qaVerdict.ts`
- Modify: `src/app/api/tickets/[id]/verdict/route.ts`
- Test: `tests/server/qaVerdict.test.ts`, `tests/server/verdictRoute.test.ts`

**Interfaces:**
- Produces: `QaArg` gains `"mark-done"`; `QaVerdictDeps` gains `isMerged: () => Promise<boolean>`; `QaVerdictResult` gains `{ done: "marked-done" }`.
- Consumes: `isAlreadyMerged` (Task 8), `resolveTicketDirs` (Task 9).

- [ ] **Step 1: Write the failing tests**

In `tests/server/qaVerdict.test.ts`, add `isMerged: vi.fn(async () => true)` to the `deps()` factory, update the two key-order assertions accordingly (`["merge", "setIssueStatus", "launchMergeFix", "isMerged"]`), extend the arg-set case, and add the block:

```ts
describe("QA_ARGS", () => {
  it("is the exact accepted verdict set", () => {
    expect([...QA_ARGS]).toEqual(["approve-local", "approve-mr", "mark-done"]);
  });
});

describe("resolveQaVerdict mark-done", () => {
  it("writes Done and runs no git when the branch is already merged", async () => {
    const d = deps();
    const res = await resolveQaVerdict({ ticket: "RIC-110", arg: "mark-done" }, d);
    expect(res).toEqual({ done: "marked-done" });
    expect(d.setIssueStatus).toHaveBeenCalledWith("RIC-110", "Done");
    expect(d.merge).not.toHaveBeenCalled();
    expect(d.launchMergeFix).not.toHaveBeenCalled();
  });

  // The gate rendered from a check that may be seconds old; re-check before writing Done.
  it("throws and writes no status when the branch is not merged", async () => {
    const d = deps();
    d.isMerged.mockImplementation(async () => false);
    await expect(resolveQaVerdict({ ticket: "RIC-110", arg: "mark-done" }, d))
      .rejects.toBeInstanceOf(QaVerdictError);
    expect(d.setIssueStatus).not.toHaveBeenCalled();
  });

  it("never asks the merge question on an approve", async () => {
    const d = deps();
    await resolveQaVerdict({ ticket: "RIC-110", arg: "approve-local" }, d);
    expect(d.isMerged).not.toHaveBeenCalled();
  });
});
```

In `tests/server/verdictRoute.test.ts`, add a case in the file's existing style:

```ts
  it("mark-done moves the ticket to Done without merging", async () => {
    h.isAlreadyMerged.mockResolvedValue(true);
    const res = await POST(req({ arg: "mark-done" }), params("RIC-110"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, result: { done: "marked-done" } });
    expect(h.setIssueStatus).toHaveBeenCalledWith(expect.anything(), "RIC-110", "Done");
    expect(h.mergeTicketBranch).not.toHaveBeenCalled();
  });
```

Add `isAlreadyMerged: vi.fn(async () => true)` to that file's hoisted mock object and to its `vi.mock("@/server/merge", …)` factory, matching the existing shape.

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/server/qaVerdict.test.ts`
Expected: FAIL — `mark-done` is not assignable to `QaArg`.

- [ ] **Step 3: Implement — `qaVerdict.ts`**

```ts
export type QaArg = "approve-local" | "approve-mr" | "mark-done";
export const QA_ARGS: readonly QaArg[] = ["approve-local", "approve-mr", "mark-done"];
```

```ts
export interface QaVerdictDeps {
  merge: (mode: MergeMode) => Promise<MergeOutcome>;
  setIssueStatus: (ticket: string, target: string) => Promise<void>;
  launchMergeFix: (detail: string, mode: MergeMode) => Promise<string>;
  // Whether the ticket's branch is already in the default branch. Asked only by mark-done.
  isMerged: () => Promise<boolean>;
}

export type QaVerdictResult =
  | { done: "merged"; commit: string }
  | { done: "mr-created"; url: string }
  | { done: "fix-session"; sessionId: string; detail: string }
  | { done: "marked-done" };
```

Add the branch at the top of `resolveQaVerdict`, before the mode is derived:

```ts
  const { ticket, arg } = input;
  if (arg === "mark-done") {
    // Someone merged the branch outside Mojito, so there is nothing to run — only the board
    // is behind. Re-check rather than trust the gate: the UI decided seconds ago, and writing
    // Done for an unmerged branch would lose the ticket.
    if (!(await deps.isMerged())) throw new QaVerdictError("branch is not merged");
    await deps.setIssueStatus(ticket, "Done");
    return { done: "marked-done" };
  }
```

Update the function's doc comment to name the third verdict.

- [ ] **Step 4: Implement — the verdict route**

Add `isAlreadyMerged` to the `@/server/merge` import and wire the dep next to `merge`:

```ts
          isMerged: async () => {
            const { worktree, repoRoot } = await resolveDirs();
            if (!worktree || !repoRoot || worktree === repoRoot) return false;
            return isAlreadyMerged({ worktree, repoRoot });
          },
```

- [ ] **Step 5: Run the gate**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/qaVerdict.ts src/app/api/tickets tests/server
git commit -m "feat(qa): add the mark-done verdict for an already-merged branch"
```

---

### Task 11: The QA gate UI

**Files:**
- Create: `src/lib/qaGate.ts`
- Create: `tests/lib/qaGate.test.ts`
- Modify: `src/components/QaVerdictButtons.tsx`
- Modify: `src/components/LaunchSheet.tsx`

**Interfaces:**
- Produces: `MergeState = "checking" | "merged" | "unmerged"`; `qaGateModel(state: MergeState): { approve: boolean; markDone: boolean; checking: boolean }`.
- Consumes: `GET /api/tickets/<id>/merge-state` (Task 9), the `mark-done` verdict (Task 10), `tmuxName` at To QA returning the work id (Task 7).

- [ ] **Step 1: Write the failing test**

Create `tests/lib/qaGate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { qaGateModel } from "@/lib/qaGate";

describe("qaGateModel", () => {
  it("offers nothing while the merge state is unknown", () => {
    expect(qaGateModel("checking")).toEqual({ approve: false, markDone: false, checking: true });
  });

  // Re-running a merge that already happened is a no-op at best, so the approves go away.
  it("offers only mark-done for an already-merged branch", () => {
    expect(qaGateModel("merged")).toEqual({ approve: false, markDone: true, checking: false });
  });

  it("offers the two approves for an unmerged branch", () => {
    expect(qaGateModel("unmerged")).toEqual({ approve: true, markDone: false, checking: false });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/lib/qaGate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement — `src/lib/qaGate.ts`**

```ts
// Which verdicts the To QA gate offers, given what git says about the branch. Pure so it can
// be tested without a render harness, following terminalHeadModel and holdsSheetOpen.
export type MergeState = "checking" | "merged" | "unmerged";

export interface QaGateModel {
  /** The two approve buttons, which run the server-side merge. */
  approve: boolean;
  /** The status-only verdict: the branch is already in the default branch. */
  markDone: boolean;
  /** No verdict can be submitted yet — the merge state is still being read. */
  checking: boolean;
}

export function qaGateModel(state: MergeState): QaGateModel {
  return {
    approve: state === "unmerged",
    markDone: state === "merged",
    checking: state === "checking",
  };
}
```

- [ ] **Step 4: Implement — `QaVerdictButtons.tsx`**

```tsx
"use client";
import type { QaGateModel } from "@/lib/qaGate";

// Approve is two buttons, not one: the merge is done server-side and the user chooses how it
// lands — a local fast-forward onto the default branch, or a pushed branch + MR/PR. A branch
// that is already merged gets neither, only the status write. There is no reject: a ticket
// that fails QA is reworked by typing into the session that built it, which is still alive.
export default function QaVerdictButtons(
  { pending, gate, onApprove, onMarkDone }:
  { pending: "approve-local" | "approve-mr" | "mark-done" | null;
    gate: QaGateModel;
    onApprove: (arg: "approve-local" | "approve-mr") => void;
    onMarkDone: () => void },
) {
  // The server-side merge takes 10s+: while a verdict is in flight, every button is disabled
  // and the one that was clicked says what it is doing.
  const busy = pending !== null;

  if (gate.checking) return <p className="hint">Checking whether the branch is already merged…</p>;

  return (
    <div className="btns">
      {gate.markDone && (
        <button className="btn primary" disabled={busy} onClick={onMarkDone}>
          {pending === "mark-done" ? "Marking Done…" : "Mark Done · already merged"}
        </button>
      )}
      {gate.approve && (
        <>
          <button className="btn primary" disabled={busy} onClick={() => onApprove("approve-local")}>
            {pending === "approve-local" ? "Merging…" : "Approve · merge"}
          </button>
          <button className="btn primary" disabled={busy} onClick={() => onApprove("approve-mr")}>
            {pending === "approve-mr" ? "Opening MR…" : "Approve · MR"}
          </button>
        </>
      )}
    </div>
  );
}
```

If `hint` is not an existing class in `src/app/globals.css`, use the class the sheet already uses for secondary text (check `sheet-title` / `outcome-body`) rather than inventing one.

- [ ] **Step 5: Implement — `LaunchSheet.tsx`**

1. Imports: add `import { qaGateModel, type MergeState } from "@/lib/qaGate";`

2. Move the `isToQa` definition up, next to the `existing` lookups (it currently sits at line ~171, below the launch handlers), and seed the selectors from the In Progress profile at To QA — To QA is not in `LAUNCHABLE_STATUSES`, so it has no stage defaults of its own:

```tsx
  const isToQa = ticket.statusName === "To QA";
  // A To QA launch is a work session (Task 7 gives it the work id), so it takes the work
  // profile rather than the app-wide fallback.
  const stageKey = isToQa ? "In Progress" : ticket.statusName;
```

Use `stageKey` in both `useState` initializers and in the re-seed `useEffect` in place of `ticket.statusName`.

3. Verdict state and the merge-state probe:

```tsx
  const [verdictPending, setVerdictPending] = useState<"approve-local" | "approve-mr" | "mark-done" | null>(null);
  const [mergeState, setMergeState] = useState<MergeState>("checking");
  // Ask git whether the branch already landed before offering to merge it. A failed or
  // unreachable check degrades to the ordinary approve buttons — never to a dead gate.
  useEffect(() => {
    if (!isToQa) return;
    let live = true;
    (async () => {
      try {
        const qs = ticket.project ? `?projectName=${encodeURIComponent(ticket.project)}` : "";
        const res = await apiFetch(token, `/api/tickets/${ticket.identifier}/merge-state${qs}`);
        const merged = res.ok && (await res.json())?.merged === true;
        if (live) setMergeState(merged ? "merged" : "unmerged");
      } catch {
        if (live) setMergeState("unmerged");
      }
    })();
    return () => { live = false; };
  }, [isToQa, token, ticket.identifier, ticket.project]);
```

4. `submitVerdict` accepts the third arg:

```tsx
  const submitVerdict = async (arg: "approve-local" | "approve-mr" | "mark-done") => {
```

5. The To QA branch of the render (replacing the current one at ~line 250):

```tsx
        {isToQa ? (
          <>
            <QaVerdictButtons
              pending={verdictPending}
              gate={qaGateModel(mergeState)}
              onApprove={(a) => submitVerdict(a)}
              onMarkDone={() => submitVerdict("mark-done")}
            />
            {err && <p className="err-text">{err}</p>}
            {/* QA rework happens in the session that built the branch, so the sheet's job at
                To QA is to get you into it — or to replace it if it died. */}
            {existing ? (
              <button className="btn ghost block" style={{ marginTop: 12 }} onClick={() => onOpen(existing)}>
                Open session (<StateBadge state={existing.state} />)
              </button>
            ) : (
              <button className="btn primary block" style={{ marginTop: 12 }} disabled={launchBusy} onClick={() => start()}>
                {launching === "work" ? "Starting…" : "Start work session"}
              </button>
            )}
            {selectors}
            {customBtn}
          </>
        ) : existingActive ? (
```

- [ ] **Step 6: Run the gate**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 7: Verify by hand**

Start the app (`npm run dev` or the project's usual command) and open a ticket at To QA:
- With an unmerged branch: two approve buttons, plus "Open session" if its work session is live.
- With a branch already merged into the default branch: only "Mark Done · already merged"; clicking it moves the ticket to Done and closes the sheet.
- With the work session killed (`tmux kill-session -t mojito-<ticket>-work`): the sheet offers "Start work session", the launch succeeds, and the ticket stays at To QA.

- [ ] **Step 8: Commit**

```bash
git add src/lib/qaGate.ts tests/lib/qaGate.test.ts src/components/QaVerdictButtons.tsx src/components/LaunchSheet.tsx
git commit -m "feat(qa): gate the verdict buttons on the branch's merge state"
```

---

### Task 12: Update CLAUDE.md

The repo's own description of the lifecycle is now wrong in four places. It is documentation an agent reads first, so it lands as its own reviewable change.

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Rewrite the affected bullets**

- **Prompts bullet:** the work prompt no longer carries a phase sequence. State that it carries only the context file, the result file, and the worktree convention, and that the asset paragraph appears only when the launch downloaded something.
- **Session context bullet (line ~23):** drop `rejectReason` from the JSON shape.
- **Outcome channel bullet:** the result file is `{outcome: "ready-for-qa" | "merged"}` — no `notes`, no `blocked` — and it is written at the end of *every* round, not once.
- **QA gate bullet (line ~32):** replace the reject clause. New text: approve runs the server-side rebase+merge (a Claude session only on conflict); a branch already merged outside Mojito offers `mark-done`, which writes Done and runs no git; there is no reject — a ticket that fails QA is reworked by typing into its still-live work session, and the ticket parks at To QA meanwhile.
- **Status model bullet:** note that the work session id `mojito-<ticket>-work` now also covers To QA, so a session relaunched at the gate takes its predecessor's id.

- [ ] **Step 2: Verify the claims**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS. Re-read each edited bullet against the code it describes; a wrong CLAUDE.md is worse than none.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: describe the live-session QA loop"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| 1. The lifecycle | 2 (loop), 7 (relaunch), 11 (gate UI) |
| 2. Reject is removed | 5 (server), 6 (client), 12 (docs) |
| 3. Result file shrinks | 1 |
| 4. The work prompt | 3 |
| 5. Relaunching at To QA | 7 (id), 11 (sheet, stage defaults) |
| 6. Already-merged + mark-done | 8 (detection), 9 (endpoint), 10 (verdict), 11 (UI) |
| Failure modes | 2 (rework loop), 8 (git failure → false), 10 (TOCTOU re-check) |
| Tests | every task |

No spec requirement is unassigned. "Approve while a rework round is in flight" is explicitly out of scope in the spec and has no task, by design.

**Type consistency:** `QaArg` / `QA_ARGS` are narrowed in Task 5 and widened in Task 10 — the ordering is deliberate, and Task 10 restates both. `QaVerdictDeps` loses `launchRework` (Task 5) and gains `isMerged` (Task 10); the key-order assertions in `tests/server/qaVerdict.test.ts` are updated in both tasks. `buildWorkPrompt` takes `WorkPromptVars` from Task 3 onward; `buildMergeFixPrompt` keeps `MergeFixPromptVars` and is fed `baseVars` without `hasAssets`. `MergeState` and `QaGateModel` are defined once, in Task 11.
