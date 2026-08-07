# Mojito-Native Lifecycle (Remove lime) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the lime plugin dependency: Mojito owns the stage prompts, all Linear writes, and a collapsed `Todo → In Progress → To QA → Done` lifecycle; spawned sessions never touch Linear and report their outcome through a result file.

**Architecture:** Sessions are launched with a full prompt built by Mojito (no `/lime-*` slash commands) and a context file that now carries the ticket description. A session's only output channels are git commits and `MOJITO_STATE_DIR/results/<id>.json`; the Stop hook reads that file and Mojito moves the Linear status over its existing GraphQL client. QA approve runs a server-side rebase+merge (`merge.ts`), launching a Claude session only on conflict; reject launches the rework session with the reason in its context file.

**Tech Stack:** Next.js + TypeScript, vitest, tmux, Linear GraphQL API (existing `src/server/linear.ts` client), `gh`/`glab` CLIs for MR creation.

**Spec:** `docs/superpowers/specs/2026-08-07-mojito-native-lifecycle-design.md`

## Global Constraints

- All code artifacts in English (identifiers, comments, commit messages).
- Test gate for every task: `npx tsc --noEmit && npx vitest run` must pass at the end of the task.
- Sessions must make **zero** Linear reads or writes — no Linear MCP, no API. Every prompt template must state this.
- Linear writes allowed from Mojito only: issue creation, status transitions, assignee. **No comments** (`postComment` stays only as dead-code-to-remove candidate; do not add call sites).
- New status model, exact names: `Backlog`, `Todo`, `In Progress`, `To QA`, `Done`, `Canceled`, `Duplicate`.
- Existing shell-quoting pattern `const q = (s) => `'${s.replace(/'/g, "'\\''")}'`` must wrap every value interpolated into a tmux command.
- Commit after every task (each task ends with a commit step).

---

### Task 1: Linear client — `getIssueDescription` and `createIssue`

**Files:**
- Modify: `src/server/linear.ts` (append after `getIssueRef`, ~line 103)
- Test: `tests/server/linear.test.ts` (extend if it exists; create otherwise)

**Interfaces:**
- Consumes: existing `query()` helper and `parseIdentifier` in `linear.ts`.
- Produces:
  - `getIssueDescription(apiKey: string, identifier: string, fetchImpl?: typeof fetch): Promise<string>` — `""` for a null description, throws `issue not found: <id>` when the issue does not exist.
  - `createIssue(apiKey: string, input: { teamKey: string; title: string; description: string; projectName: string | null }, fetchImpl?: typeof fetch): Promise<{ identifier: string }>`

- [ ] **Step 1: Write the failing tests.** All Linear tests in this repo inject `fetchImpl`; follow the same stub pattern (a fake `fetch` returning canned GraphQL JSON, asserting on the request bodies it saw). Add:

```ts
import { describe, it, expect } from "vitest";
import { getIssueDescription, createIssue } from "@/server/linear";

function fakeFetch(responses: object[]) {
  const calls: { body: string }[] = [];
  let i = 0;
  const impl = (async (_url: unknown, init?: { body?: unknown }) => {
    calls.push({ body: String(init?.body ?? "") });
    const data = responses[Math.min(i++, responses.length - 1)];
    return { ok: true, json: async () => ({ data }) };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("getIssueDescription", () => {
  it("returns the description", async () => {
    const { impl } = fakeFetch([{ issues: { nodes: [{ description: "the body" }] } }]);
    expect(await getIssueDescription("key", "RIC-46", impl)).toBe("the body");
  });
  it("maps a null description to empty string", async () => {
    const { impl } = fakeFetch([{ issues: { nodes: [{ description: null }] } }]);
    expect(await getIssueDescription("key", "RIC-46", impl)).toBe("");
  });
  it("throws when the issue does not exist", async () => {
    const { impl } = fakeFetch([{ issues: { nodes: [] } }]);
    await expect(getIssueDescription("key", "RIC-999", impl)).rejects.toThrow("issue not found");
  });
});

describe("createIssue", () => {
  it("resolves team and project, then creates", async () => {
    const { impl, calls } = fakeFetch([
      { teams: { nodes: [{ id: "team-1", key: "RIC" }] } },
      { projects: { nodes: [{ id: "proj-1", name: "Mojito" }] } },
      { issueCreate: { success: true, issue: { identifier: "RIC-200" } } },
    ]);
    const res = await createIssue("key", { teamKey: "RIC", title: "T", description: "D", projectName: "Mojito" }, impl);
    expect(res.identifier).toBe("RIC-200");
    expect(calls[2].body).toContain("proj-1");
  });
  it("creates without a project when projectName is null", async () => {
    const { impl, calls } = fakeFetch([
      { teams: { nodes: [{ id: "team-1", key: "RIC" }] } },
      { issueCreate: { success: true, issue: { identifier: "RIC-201" } } },
    ]);
    const res = await createIssue("key", { teamKey: "RIC", title: "T", description: "D", projectName: null }, impl);
    expect(res.identifier).toBe("RIC-201");
    expect(calls).toHaveLength(2);
  });
  it("throws when the team is unknown", async () => {
    const { impl } = fakeFetch([{ teams: { nodes: [] } }]);
    await expect(createIssue("key", { teamKey: "XX", title: "T", description: "D", projectName: null }, impl))
      .rejects.toThrow("team not found: XX");
  });
});
```

- [ ] **Step 2: Run to verify failure.** `npx vitest run tests/server/linear.test.ts` — expect FAIL (exports missing).
- [ ] **Step 3: Implement** (append to `src/server/linear.ts`):

```ts
export async function getIssueDescription(
  apiKey: string,
  identifier: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const { teamKey, number } = parseIdentifier(identifier);
  const data = await query<{ issues: { nodes: { description?: string | null }[] } }>(
    apiKey,
    {
      query: `query ($key: String!, $n: Float!) {
        issues(filter: { team: { key: { eq: $key } }, number: { eq: $n } }, first: 1) {
          nodes { description }
        }
      }`,
      variables: { key: teamKey, n: number },
    },
    fetchImpl,
  );
  const node = data.issues.nodes[0];
  if (!node) throw new Error(`issue not found: ${identifier}`);
  return node.description ?? "";
}

export async function createIssue(
  apiKey: string,
  input: { teamKey: string; title: string; description: string; projectName: string | null },
  fetchImpl: typeof fetch = fetch,
): Promise<{ identifier: string }> {
  const teams = await query<{ teams: { nodes: { id: string; key: string }[] } }>(
    apiKey,
    {
      query: `query ($key: String!) { teams(filter: { key: { eq: $key } }, first: 1) { nodes { id key } } }`,
      variables: { key: input.teamKey },
    },
    fetchImpl,
  );
  const team = teams.teams.nodes[0];
  if (!team) throw new Error(`team not found: ${input.teamKey}`);

  // An unknown project name degrades to "no project" rather than failing the creation.
  let projectId: string | undefined;
  if (input.projectName) {
    const projects = await query<{ projects: { nodes: { id: string; name: string }[] } }>(
      apiKey,
      {
        query: `query ($name: String!) { projects(filter: { name: { eq: $name } }, first: 1) { nodes { id name } } }`,
        variables: { name: input.projectName },
      },
      fetchImpl,
    );
    projectId = projects.projects.nodes[0]?.id;
  }

  const created = await query<{ issueCreate: { success: boolean; issue?: { identifier?: string } } }>(
    apiKey,
    {
      query: `mutation ($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { identifier } } }`,
      variables: {
        input: {
          teamId: team.id,
          title: input.title,
          description: input.description,
          ...(projectId ? { projectId } : {}),
        },
      },
    },
    fetchImpl,
  );
  const identifier = created.issueCreate.issue?.identifier;
  if (!created.issueCreate.success || !identifier) throw new Error("Linear issueCreate failed");
  return { identifier };
}
```

- [ ] **Step 4: Verify.** `npx tsc --noEmit && npx vitest run` — expect PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(linear): add getIssueDescription and createIssue"`

---

### Task 2: Session result channel

**Files:**
- Create: `src/server/sessionResult.ts`
- Test: `tests/server/sessionResult.test.ts`

**Interfaces:**
- Produces:
  - `interface SessionResult { outcome: "ready-for-qa" | "blocked"; notes?: string }`
  - `resultPath(stateDir: string, id: string): string` — `<stateDir>/results/<id>.json`, creates the `results` dir (mode 0700).
  - `readSessionResult(stateDir: string, id: string): SessionResult | null` — null on missing/malformed/unknown outcome.
  - `clearSessionResult(stateDir: string, id: string): void` — idempotent remove.

- [ ] **Step 1: Write the failing tests** (`tests/server/sessionResult.test.ts`; use `mkdtempSync(join(tmpdir(), "mojito-"))` for `stateDir` like the sidecar tests):

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resultPath, readSessionResult, clearSessionResult } from "@/server/sessionResult";

const dir = () => mkdtempSync(join(tmpdir(), "mojito-results-"));

describe("sessionResult", () => {
  it("round-trips a ready-for-qa result", () => {
    const stateDir = dir();
    writeFileSync(resultPath(stateDir, "s1"), JSON.stringify({ outcome: "ready-for-qa", notes: "built X" }));
    expect(readSessionResult(stateDir, "s1")).toEqual({ outcome: "ready-for-qa", notes: "built X" });
  });
  it("returns null for a missing file", () => {
    expect(readSessionResult(dir(), "absent")).toBeNull();
  });
  it("returns null for malformed JSON and unknown outcomes", () => {
    const stateDir = dir();
    writeFileSync(resultPath(stateDir, "bad"), "{nope");
    expect(readSessionResult(stateDir, "bad")).toBeNull();
    writeFileSync(resultPath(stateDir, "odd"), JSON.stringify({ outcome: "done" }));
    expect(readSessionResult(stateDir, "odd")).toBeNull();
  });
  it("clear removes the file and tolerates absence", () => {
    const stateDir = dir();
    writeFileSync(resultPath(stateDir, "s2"), JSON.stringify({ outcome: "blocked" }));
    clearSessionResult(stateDir, "s2");
    expect(readSessionResult(stateDir, "s2")).toBeNull();
    clearSessionResult(stateDir, "s2"); // second call must not throw
  });
});
```

- [ ] **Step 2: Run to verify failure**, then **implement** `src/server/sessionResult.ts`:

```ts
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

// What a ticket session reports back at the end of its work. Written by the spawned
// session (the launch prompt names this exact path); read by the Stop/SessionEnd hook.
export interface SessionResult {
  outcome: "ready-for-qa" | "blocked";
  notes?: string;
}

export function resultPath(stateDir: string, id: string): string {
  const dir = join(stateDir, "results");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return join(dir, `${id}.json`);
}

// null on missing, unreadable, malformed, or unknown-outcome file — the caller treats
// all of those as "the session reported nothing".
export function readSessionResult(stateDir: string, id: string): SessionResult | null {
  try {
    const parsed = JSON.parse(readFileSync(resultPath(stateDir, id), "utf8")) as {
      outcome?: unknown;
      notes?: unknown;
    };
    if (parsed.outcome !== "ready-for-qa" && parsed.outcome !== "blocked") return null;
    return { outcome: parsed.outcome, ...(typeof parsed.notes === "string" ? { notes: parsed.notes } : {}) };
  } catch {
    return null;
  }
}

export function clearSessionResult(stateDir: string, id: string): void {
  try {
    rmSync(resultPath(stateDir, id));
  } catch {
    /* already gone */
  }
}
```

- [ ] **Step 3: Verify.** `npx tsc --noEmit && npx vitest run` — PASS.
- [ ] **Step 4: Commit.** `git commit -am "feat(server): session result channel (results/<id>.json)"`

---

### Task 3: Prompt templates and builder

**Files:**
- Create: `src/server/prompts/work.ts`, `src/server/prompts/conflict.ts` (TypeScript template constants, not `.md` files: runtime file reads are fragile under Next.js bundling, constants are testable and always shipped)
- Create: `src/server/prompts.ts`
- Test: `tests/server/prompts.test.ts`

**Interfaces:**
- Produces:
  - `interface PromptVars { ticket: string; contextPath: string; resultPath: string }`
  - `buildWorkPrompt(vars: PromptVars): string`
  - `buildConflictPrompt(vars: PromptVars): string`
  - Both throw when any var contains `{{` (guards against nested-placeholder injection) and never leave a `{{...}}` placeholder unreplaced.

- [ ] **Step 1: Write the failing tests:**

```ts
import { describe, it, expect } from "vitest";
import { buildWorkPrompt, buildConflictPrompt } from "@/server/prompts";

const vars = { ticket: "RIC-46", contextPath: "/state/context/s1.json", resultPath: "/state/results/s1.json" };

describe("prompt builder", () => {
  it("interpolates all placeholders in the work prompt", () => {
    const p = buildWorkPrompt(vars);
    expect(p).toContain("RIC-46");
    expect(p).toContain("/state/context/s1.json");
    expect(p).toContain("/state/results/s1.json");
    expect(p).not.toContain("{{");
  });
  it("interpolates all placeholders in the conflict prompt", () => {
    const p = buildConflictPrompt(vars);
    expect(p).toContain("RIC-46");
    expect(p).not.toContain("{{");
  });
  it("forbids Linear access and requires the result file in both prompts", () => {
    for (const p of [buildWorkPrompt(vars), buildConflictPrompt(vars)]) {
      expect(p.toLowerCase()).toContain("never use any linear");
      expect(p).toContain('"ready-for-qa"');
    }
  });
});
```

- [ ] **Step 2: Implement** `src/server/prompts/work.ts`:

```ts
// The full work-phase prompt for a ticket session: design → plan → implement → review
// in one session. The session never touches Linear — Mojito owns all Linear reads and
// writes; the session's only output channels are git commits and the result file.
export const WORK_PROMPT_TEMPLATE = `You are working Linear ticket {{TICKET}} end to end in this repository.

First read the JSON session context at {{CONTEXT_PATH}}: identifier, statusName,
title, project, labels, description, and optionally rejectReason. Never use any
Linear tool, MCP server, or API in this session — Mojito manages Linear for you.

Follow this sequence:

1. Isolation: create (or reuse) a worktree and branch named after {{TICKET}} via
   the superpowers:using-git-worktrees skill. If the current directory already is
   that worktree, stay in it.
2. Design: if the labels include "Bug", use superpowers:systematic-debugging;
   otherwise use superpowers:brainstorming. A genuine open design question is a
   blocking gate: ask it and end your turn. Do not commit a spec or plan and do
   not proceed until the user has answered.
3. Plan: produce the spec and the implementation plan via superpowers:writing-plans.
4. Implement: execute the plan with superpowers:subagent-driven-development. Every
   subagent prompt must carry this worktree's absolute path, and each subagent
   must verify it is on the {{TICKET}} branch before committing.
5. Review: run superpowers:requesting-code-review over the whole branch diff
   (default branch..HEAD). Fix blocking findings and re-review only the fix
   range, at most twice; if findings still block after that, report "blocked".

If the context contains rejectReason, this is QA rework, not a fresh start: skip
steps 2–3, convert the reason into concrete unchecked tasks appended to the
ticket's existing plan under docs/superpowers/plans/, then run steps 4–5 on
those tasks only.

Result file — REQUIRED. As the very last action, write {{RESULT_PATH}} with
exactly one JSON object:
  {"outcome": "ready-for-qa", "notes": "<one line: what was built>"}
when the branch is complete, reviewed, and ready for human QA, or
  {"outcome": "blocked", "notes": "<one line: what is missing>"}
when you cannot finish without the user. Never write it earlier, and never write
it when stopping at the design gate in step 2.`;
```

`src/server/prompts/conflict.ts`:

```ts
// Prompt for the conflict-resolution session Mojito launches when the server-side
// rebase (QA approve) hits conflicts. Same result-file contract as the work prompt.
export const CONFLICT_PROMPT_TEMPLATE = `The QA-approved branch for Linear ticket {{TICKET}} could not be rebased onto
the repository's default branch: the rebase hit conflicts and was aborted. You
are in the ticket's worktree. Never use any Linear tool, MCP server, or API —
Mojito manages Linear for you.

First read the JSON session context at {{CONTEXT_PATH}} (identifier, title,
description) for what the branch was meant to do.

1. Rebase the current branch onto the default branch and resolve every conflict,
   preserving the intent of both sides.
2. Run the project's checks (typecheck/tests) if the repository has them.
3. Review the post-rebase diff against the default branch with
   superpowers:requesting-code-review; fix blocking findings.

Result file — REQUIRED. As the very last action, write {{RESULT_PATH}} with
exactly one JSON object: {"outcome": "ready-for-qa", "notes": "rebased onto the
default branch"} on success, or {"outcome": "blocked", "notes": "<one line:
why>"} if the conflicts cannot be resolved safely.`;
```

`src/server/prompts.ts`:

```ts
import { WORK_PROMPT_TEMPLATE } from "./prompts/work.js";
import { CONFLICT_PROMPT_TEMPLATE } from "./prompts/conflict.js";

export interface PromptVars {
  ticket: string;
  contextPath: string;
  resultPath: string;
}

function render(template: string, vars: PromptVars): string {
  for (const [k, v] of Object.entries(vars)) {
    if (v.includes("{{")) throw new Error(`prompt var ${k} must not contain '{{'`);
  }
  return template
    .replaceAll("{{TICKET}}", vars.ticket)
    .replaceAll("{{CONTEXT_PATH}}", vars.contextPath)
    .replaceAll("{{RESULT_PATH}}", vars.resultPath);
}

export const buildWorkPrompt = (vars: PromptVars): string => render(WORK_PROMPT_TEMPLATE, vars);
export const buildConflictPrompt = (vars: PromptVars): string => render(CONFLICT_PROMPT_TEMPLATE, vars);
```

- [ ] **Step 3: Verify.** `npx tsc --noEmit && npx vitest run` — PASS.
- [ ] **Step 4: Commit.** `git commit -am "feat(server): work and conflict prompt templates"`

---

### Task 4: Session kind `"lime"` → `"ticket"`

**Files:**
- Modify: `src/server/types.ts:16`, `src/server/launch.ts:119`, `src/server/sidecar.ts:24-25`, `src/server/hookHandler.ts:26`, `src/components/SessionList.tsx:125`
- Test: `tests/server/sidecar.test.ts` (add legacy-mapping case); update `kind: "lime"` expectations across `tests/server/{launch,registry,sweep,supersede,updateSession,hookHandler}.test.ts` and `tests/lib/{sessionFilter,ticketSessionLevel,orderSessions,terminalTabTitle}.test.ts` (grep `"lime"`).

**Interfaces:**
- Produces: `SessionMeta.kind: "ticket" | "custom" | "rebase" | "shell"` (`"rebase"` survives until Task 11). `readSidecar` maps legacy persisted values: missing kind or `"lime"` → `"ticket"`.

- [ ] **Step 1: Add the failing sidecar test:**

```ts
it("maps legacy lime sidecars to kind ticket", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "mojito-sidecar-"));
  const legacy = { id: "mojito-RIC-1-todo", ticket: "RIC-1", kind: "lime" };
  writeFileSync(join(stateDir, "sessions", "mojito-RIC-1-todo.json"), JSON.stringify(legacy)); // create sessions/ first via writeSidecar of another meta, or mkdirSync
  expect(readSidecar(stateDir, "mojito-RIC-1-todo")?.kind).toBe("ticket");
});
```

- [ ] **Step 2: Implement.** In `types.ts` change the union and its comment: `kind: "ticket" | "custom" | "rebase" | "shell"; // "ticket" = full work-phase lifecycle session; ...`. In `sidecar.ts` replace the legacy default:

```ts
const meta = JSON.parse(readFileSync(join(sessionsDir(stateDir), `${id}.json`), "utf8"));
// Sidecars written before `kind` existed, or by the lime era, are ticket sessions.
const kind = meta.kind === "lime" || meta.kind === undefined ? "ticket" : meta.kind;
return { ...meta, kind } as SessionMeta;
```

In `launch.ts` `launchSession` set `kind: "ticket"`. In `hookHandler.ts` no code change needed yet (the custom/rebase/shell guard already excludes the lifecycle kind by name — verify the condition is on the *other* kinds, it is). In `SessionList.tsx:125` change the auto-advance toggle gate `s.kind === "lime"` → `s.kind === "ticket"` (the toggle itself is removed in Task 6).
- [ ] **Step 3: Sweep tests.** `grep -rn '"lime"' tests/ src/` and update every remaining expectation/usage to `"ticket"` (do not touch `limeProjects` imports yet — Task 12).
- [ ] **Step 4: Verify.** `npx tsc --noEmit && npx vitest run` — PASS.
- [ ] **Step 5: Commit.** `git commit -am "refactor(server): rename session kind lime to ticket"`

---

### Task 5: Launch pipeline — Mojito-built prompt, context with description, no slash commands

**Files:**
- Modify: `src/server/launchContext.ts`, `src/server/launch.ts`, `src/app/api/sessions/route.ts`, `src/components/LaunchSheet.tsx`
- Delete: `src/server/stageCommand.ts`, `tests/server/stageCommand.test.ts`
- Test: `tests/server/launch.test.ts` (rewrite lifecycle-launch assertions), `tests/server/launchContext.test.ts` (extend if present)

**Interfaces:**
- Consumes: `buildWorkPrompt` (Task 3), `resultPath`/`clearSessionResult` (Task 2), `getIssueDescription` (Task 1).
- Produces:
  - `LaunchContext` gains `description: string` and `rejectReason?: string`.
  - `LaunchRequest`: `{ ticket, status, model, effort, autoAdvance, projectName, title, labels, description, rejectReason? }` — **`trailingArg` is gone** (`autoAdvance` goes in Task 6).
  - `buildClaudeCommand(req: { model: string; effort: Effort }, settingsPath: string, prompt: string): string` — plain `claude --model … --effort … --settings … '<prompt>'`, no env prefix; throws if `prompt` starts with `-`.

- [ ] **Step 1: Update `launchContext.ts`.** Add to `LaunchContext`: `description: string;` and `rejectReason?: string;`. Update the doc comment: the file is read by the session itself (path is embedded in the prompt); no env var involved.
- [ ] **Step 2: Rewrite the lifecycle launch test expectations** in `tests/server/launch.test.ts`: the built command must (a) start with `claude --model`, (b) contain `--settings`, (c) contain the ticket id and the context/result paths inside the quoted prompt, (d) contain **no** `LIME_SESSION_CONTEXT` and no `/lime-` substring; the written context JSON must contain `description`. Run — FAIL.
- [ ] **Step 3: Implement in `launch.ts`:**
  - Replace imports of `slashForStatus` with `buildWorkPrompt` from `./prompts.js` and `resultPath, clearSessionResult` from `./sessionResult.js`.
  - Replace `buildClaudeCommand` with:

```ts
export function buildClaudeCommand(
  req: { model: string; effort: Effort },
  settingsPath: string,
  prompt: string,
): string {
  const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  if (prompt.startsWith("-")) throw new Error("prompt must not start with '-'");
  return `claude --model ${q(req.model)} --effort ${q(req.effort)} --settings ${q(settingsPath)} ${q(prompt)}`;
}
```

  - In `launchSession`, after writing the settings file:

```ts
const contextPath = writeLaunchContext(deps.stateDir, id, {
  identifier: req.ticket,
  statusName: req.status,
  title: req.title,
  project: req.projectName,
  labels: req.labels,
  description: req.description,
  ...(req.rejectReason ? { rejectReason: req.rejectReason } : {}),
});
clearSessionResult(deps.stateDir, id); // ids repeat per ticket+status: a stale result must not satisfy the new session's Stop hook
const command = buildClaudeCommand(req, settingsPath, buildWorkPrompt({
  ticket: req.ticket,
  contextPath,
  resultPath: resultPath(deps.stateDir, id),
}));
```

  - Remove `trailingArg` from `LaunchRequest` and from the command; leave the review-scaling block untouched for now (dead path once statuses migrate; removed in Task 13).
  - In `buildCustomClaudeCommand` drop the `LIME_SESSION_CONTEXT` env prefix and the `contextPath` parameter; in `launchCustomSession` stop writing a context file for ticket-scoped customs (a bare interactive session has a human driving it; it needs no machine contract). Delete the now-unused `contextPath` plumbing.
- [ ] **Step 4: Route.** In `src/app/api/sessions/route.ts`: delete the `trailingArg` whitelist block (lines 22-25) and the `trailingArg` field; before the lifecycle `launchSession` call fetch the description:

```ts
import { getIssueDescription } from "@/server/linear";
// … in the default (lifecycle) branch:
let description = "";
try { description = await getIssueDescription(cfg.linearApiKey, body.ticket); } catch { /* launch anyway with empty description */ }
```

  and pass `description` in the request object.
- [ ] **Step 5: UI.** In `LaunchSheet.tsx`: change `start` to take no argument and drop `trailingArg` from the POST body; delete the `isToMerge` constant and its two-button branch (lines 140, 195-199), leaving the single `Start session` button.
- [ ] **Step 6: Delete `src/server/stageCommand.ts` and `tests/server/stageCommand.test.ts`.** Grep `slashForStatus` — no references may remain.
- [ ] **Step 7: Verify.** `npx tsc --noEmit && npx vitest run` — PASS.
- [ ] **Step 8: Commit.** `git commit -am "feat(launch): Mojito-built work prompt replaces lime slash commands"`

---

### Task 6: Hook handler reads the result file; auto-advance machinery removed

**Files:**
- Modify: `src/server/hookHandler.ts`, `src/server/hookMap.ts` (rename param + messages), `src/app/api/hook/route.ts`, `src/server/types.ts`, `src/server/launch.ts`, `src/app/api/sessions/route.ts`, `src/components/LaunchSheet.tsx`, `src/components/SessionList.tsx`
- Delete: `src/server/autoAdvanceRunner.ts`, `tests/server/autoAdvanceRunner.test.ts`, `src/server/updateSession.ts`, `tests/server/updateSession.test.ts`; in `src/server/autoAdvance.ts` delete `decideAutoAdvance`, `stageAdvanced`, `AdvanceDecision` (keep `STAGE_OF`-derived exports until Task 7)
- Test: `tests/server/hookHandler.test.ts` (rewrite), `tests/server/hookMap.test.ts` (message strings), `tests/server/autoAdvance.test.ts` (drop deleted-function cases)

**Interfaces:**
- Consumes: `readSessionResult` / `SessionResult` (Task 2).
- Produces:

```ts
export interface HookDeps {
  registry: Registry;
  bus: EventBus;
  readResult: (id: string) => SessionResult | null;
  moveToQa: (ticket: string) => Promise<void>;
  readTranscriptTitle?: (transcriptPath: string) => string | null;
}
```

  `mapHook(event, ready: boolean, currentState)` (param renamed; `stage-done` alert message becomes `"ready for QA"`). `SessionMeta.autoAdvance` and `LaunchRequest.autoAdvance` are **removed**.

- [ ] **Step 1: Rewrite `tests/server/hookHandler.test.ts` for the ticket branch.** Cases: (a) Stop + result `ready-for-qa` → `moveToQa` called once with the ticket, state `done`; (b) Stop + no result file → state `needs-input`, `moveToQa` not called; (c) Stop + result `blocked` → `needs-input`, `moveToQa` not called; (d) SessionEnd + no result → `failed`; (e) Stop + ready but `moveToQa` rejects → state `needs-input` (Linear write failed: keep the session visible for a retry); (f) a second Stop after `done` → no second `moveToQa` call (guard on `meta.state === "done"`); (g) the existing custom/shell/rebase branch behavior unchanged. Run — FAIL.
- [ ] **Step 2: Implement the ticket branch** (replaces lines 60-88 of `hookHandler.ts`):

```ts
let ready = false;
if ((event === "Stop" || event === "SessionEnd") && meta.state !== "done") {
  const result = deps.readResult(id);
  if (result?.outcome === "ready-for-qa") {
    try {
      await deps.moveToQa(meta.ticket);
      ready = true;
    } catch {
      ready = false; // Linear write failed: Stop => needs-input so the user can retry
    }
  }
}

const outcome = mapHook(event, ready, meta.state);
deps.registry.patch(id, { state: outcome.state, message: outcome.alert?.message });
deps.bus.emit({ type: "session.state", id, state: outcome.state });
if (outcome.alert) {
  deps.bus.emit({ type: "session.alert", id, kind: outcome.alert.kind, ticket: meta.ticket, message: outcome.alert.message });
}
```

  In `hookMap.ts` rename the `statusAdvanced` parameter to `ready` and change the two `"stage complete"` messages to `"ready for QA"`.
- [ ] **Step 3: Rewire the route** (`src/app/api/hook/route.ts`): drop `getIssueStatus`/`runAutoAdvance` imports; pass

```ts
readResult: (sessionId) => readSessionResult(cfg.stateDir, sessionId),
moveToQa: (ticket) => setIssueStatus(cfg.linearApiKey, ticket, "To QA"),
```

- [ ] **Step 4: Remove auto-advance everywhere.** Delete `autoAdvanceRunner.ts` + test and `updateSession.ts` + test; find the PATCH handler that calls `updateSession` (`grep -rn updateSession src/app`) and remove it (keep DELETE in the same route file). Remove `autoAdvance` from `SessionMeta`, `LaunchRequest`, every `SessionMeta` literal in `launch.ts`, the sessions route body, the `Auto-advance` checkbox + `auto` state in `LaunchSheet.tsx`, and the `auto: on/off` toggle block in `SessionList.tsx`. In `autoAdvance.ts` delete `decideAutoAdvance`, `stageAdvanced`, `AdvanceDecision` and prune `tests/server/autoAdvance.test.ts` to the surviving exports.
- [ ] **Step 5: Verify.** `npx tsc --noEmit && npx vitest run` — PASS.
- [ ] **Step 6: Commit.** `git commit -am "feat(hooks): outcome file drives To QA; remove auto-advance machinery"`

---

### Task 7: New status model

**Files:**
- Create: `src/server/statusModel.ts`
- Delete: `src/server/autoAdvance.ts`, `tests/server/autoAdvance.test.ts`
- Modify: `src/lib/status.ts`, `src/lib/stageDefaults.ts`, `src/app/api/sessions/route.ts`, `tests/lib/status.test.ts`, `tests/lib/stageDefaults.test.ts` (and any other test asserting old statuses: `grep -rn '"To Code"\|"To Review"\|"To Merge"' tests/ src/`)

**Interfaces:**
- Produces (`src/server/statusModel.ts`):

```ts
export const WORK_STATES = ["Backlog", "Todo", "In Progress"];
export const GATE_STATES = ["To QA"];
export const TERMINAL_STATES = ["Done", "Canceled", "Duplicate"];
// The authoritative lifecycle status set; consumed by src/lib/status.ts's sync-guard test.
export const KNOWN_STATUSES: string[] = [...WORK_STATES, ...GATE_STATES, ...TERMINAL_STATES];
```

- [ ] **Step 1: Create `statusModel.ts`** as above; update every remaining `from "./autoAdvance.js"` / `@/server/autoAdvance` import to `statusModel`, then delete `autoAdvance.ts`.
- [ ] **Step 2: `src/lib/status.ts`.** New maps (update the sync comment to point at `statusModel.ts`):

```ts
export const STATUS_ORDER: Record<string, number> = {
  Backlog: 0, Todo: 1, "In Progress": 2, "To QA": 3, Done: 4, Canceled: 5, Duplicate: 6,
};
export const STATUS_COLOR: Record<string, string> = {
  Backlog: "grey", Todo: "grey", "In Progress": "blue", "To QA": "amber",
  Done: "green", Canceled: "red", Duplicate: "muted",
};
```

- [ ] **Step 3: `src/lib/stageDefaults.ts`.** Remove the `@/lib/reviewScale` import and both scaling hints. New values:

```ts
export const LAUNCHABLE_STATUSES: string[] = ["Backlog", "Todo", "In Progress"];
// One work session covers design through review; design quality dominates, so xhigh.
export const BUILTIN_STAGE_DEFAULTS: StageDefaults = {
  Backlog: { model: "opus", effort: "xhigh" },
  Todo: { model: "opus", effort: "xhigh" },
  "In Progress": { model: "opus", effort: "xhigh" },
};
export const STAGE_DEFAULT_ROWS: { label: string; statuses: string[]; hint?: string }[] = [
  { label: "Work (Backlog/Todo/In Progress)", statuses: ["Backlog", "Todo", "In Progress"] },
];
```

- [ ] **Step 4: Move the board on launch.** In the lifecycle branch of `src/app/api/sessions/route.ts`, after a successful `launchSession` for a `Backlog`/`Todo` ticket:

```ts
if (body.status === "Backlog" || body.status === "Todo") {
  try { await setIssueStatus(cfg.linearApiKey, body.ticket, "In Progress"); } catch { /* board update is best-effort */ }
}
```

- [ ] **Step 5: Sweep tests** for old status names; update `tests/lib/status.test.ts` sync-guard to import from `@/server/statusModel`.
- [ ] **Step 6: Verify.** `npx tsc --noEmit && npx vitest run` — PASS.
- [ ] **Step 7: Commit.** `git commit -am "feat(status): collapse lifecycle to Todo/In Progress/To QA/Done"`

---

### Task 8: Server-side merge module

**Files:**
- Create: `src/server/merge.ts`
- Test: `tests/server/merge.test.ts` (fixture git repos in temp dirs, like the worktree tests; skip MR-mode CLI cases — cover them by injecting a fake runner)

**Interfaces:**
- Produces:

```ts
export type GitRun = (args: string[], cwd: string) => Promise<{ stdout: string; stderr: string }>;
export type MergeMode = "local" | "mr";
export type MergeOutcome =
  | { status: "merged"; commit: string }
  | { status: "mr-created"; url: string }
  | { status: "conflict"; detail: string }
  | { status: "error"; detail: string };
export function detectDefaultBranch(repo: string, run?: GitRun): Promise<string>;
export function mergeTicketBranch(
  input: { worktree: string; repoRoot: string; mode: MergeMode },
  run?: GitRun,
  runCli?: (cmd: string, args: string[], cwd: string) => Promise<{ stdout: string }>,
): Promise<MergeOutcome>;
```

- [ ] **Step 1: Write the failing tests.** Build a fixture: `git init` a repo (default branch `main`, one commit), add a worktree with branch `ric-46` and one commit. Cases:
  - clean fast-forward (`main` unmoved) → `merged`, repo root HEAD equals branch tip;
  - clean rebase (`main` advanced on a disjoint file) → `merged`;
  - conflicting change on the same line → `conflict`, and the worktree is left clean (`git status --porcelain` empty, no `rebase-merge` dir);
  - repo root checked out on a non-default branch → `error` mentioning the branch name;
  - `mode: "mr"` with an injected fake `run`/`runCli` recording calls → asserts `push --force-with-lease -u origin <branch>` then a `gh pr create` call, returns the URL scraped from stdout.
  Follow the tmux test's pattern for skipping when `git` is unavailable (it won't be, but keep the guard consistent). Run — FAIL.
- [ ] **Step 2: Implement `src/server/merge.ts`:**

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);

export type GitRun = (args: string[], cwd: string) => Promise<{ stdout: string; stderr: string }>;
export type CliRun = (cmd: string, args: string[], cwd: string) => Promise<{ stdout: string }>;

// LC_ALL=C pins git output to English (mirrors ffPull.ts); 120s covers a slow fetch+rebase.
const defaultRun: GitRun = (args, cwd) =>
  pexec("git", args, { cwd, timeout: 120_000, encoding: "utf8", env: { ...process.env, LC_ALL: "C" }, maxBuffer: 1024 * 1024 * 64 });
const defaultCli: CliRun = (cmd, args, cwd) => pexec(cmd, args, { cwd, timeout: 60_000, encoding: "utf8" });

export type MergeMode = "local" | "mr";
export type MergeOutcome =
  | { status: "merged"; commit: string }
  | { status: "mr-created"; url: string }
  | { status: "conflict"; detail: string }
  | { status: "error"; detail: string };

function detailOf(e: unknown): string {
  if (e && typeof e === "object" && "stderr" in e && typeof (e as { stderr: unknown }).stderr === "string") {
    return (e as { stderr: string }).stderr.trim().slice(0, 500);
  }
  return (e instanceof Error ? e.message : String(e)).slice(0, 500);
}

export async function detectDefaultBranch(repo: string, run: GitRun = defaultRun): Promise<string> {
  try {
    const { stdout } = await run(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], repo);
    const name = stdout.trim().replace(/^origin\//, "");
    if (name) return name;
  } catch {
    /* no origin/HEAD ref — fall through to local candidates */
  }
  for (const name of ["main", "master"]) {
    try {
      await run(["rev-parse", "--verify", `refs/heads/${name}`], repo);
      return name;
    } catch {
      /* try next */
    }
  }
  throw new Error("cannot determine default branch");
}

/**
 * The QA-approve merge: rebase the worktree branch onto the (possibly remote) default
 * branch, then either fast-forward the repo root ("local") or push + open an MR ("mr").
 * A conflicted rebase is aborted so the worktree is always left clean for the
 * conflict-resolution session that follows.
 */
export async function mergeTicketBranch(
  input: { worktree: string; repoRoot: string; mode: MergeMode },
  run: GitRun = defaultRun,
  runCli: CliRun = defaultCli,
): Promise<MergeOutcome> {
  const { worktree, repoRoot, mode } = input;
  try {
    const branch = (await run(["rev-parse", "--abbrev-ref", "HEAD"], worktree)).stdout.trim();
    const hasRemote = (await run(["remote"], worktree)).stdout.trim().length > 0;
    if (hasRemote) await run(["fetch", "--prune"], worktree);
    const def = await detectDefaultBranch(repoRoot, run);
    const target = hasRemote ? `origin/${def}` : def;

    try {
      await run(["rebase", target], worktree);
    } catch (e) {
      try {
        await run(["rebase", "--abort"], worktree);
      } catch {
        /* nothing to abort */
      }
      return { status: "conflict", detail: detailOf(e) };
    }

    if (mode === "mr") {
      await run(["push", "--force-with-lease", "-u", "origin", branch], worktree);
      const origin = (await run(["remote", "get-url", "origin"], worktree)).stdout;
      const [cmd, ...args] = origin.includes("gitlab")
        ? ["glab", "mr", "create", "--fill", "--yes"]
        : ["gh", "pr", "create", "--fill", "--head", branch];
      const { stdout } = await runCli(cmd, args, worktree);
      return { status: "mr-created", url: (stdout.match(/https?:\/\/\S+/) ?? [""])[0] };
    }

    // local: the repo root's checkout receives the merge, so it must be on the default branch.
    const rootBranch = (await run(["rev-parse", "--abbrev-ref", "HEAD"], repoRoot)).stdout.trim();
    if (rootBranch !== def) return { status: "error", detail: `repo root is on ${rootBranch}, not ${def}` };
    await run(["merge", "--ff-only", branch], repoRoot);
    const commit = (await run(["rev-parse", "--short", "HEAD"], repoRoot)).stdout.trim();
    return { status: "merged", commit };
  } catch (e) {
    return { status: "error", detail: detailOf(e) };
  }
}
```

- [ ] **Step 3: Verify.** `npx tsc --noEmit && npx vitest run` — PASS (fixture tests included).
- [ ] **Step 4: Commit.** `git commit -am "feat(server): server-side rebase+merge for QA approve"`

---

### Task 9: QA verdict — approve merges, reject launches rework

**Files:**
- Modify: `src/server/qaVerdict.ts` (rewrite), `src/server/ticketVerdict.ts`, `src/app/api/tickets/[id]/verdict/route.ts`, `src/server/sessionKey.ts` (add `conflictSessionName`), `src/server/launch.ts` (add `launchConflictSession`), `src/components/QaVerdictButtons.tsx`, `src/components/LaunchSheet.tsx`
- Test: `tests/server/qaVerdict.test.ts` (rewrite), `tests/server/ticketVerdict.test.ts`, `tests/server/launch.test.ts` (conflict launcher), UI test if one exists for QaVerdictButtons

**Interfaces:**
- Consumes: `mergeTicketBranch`/`MergeMode`/`MergeOutcome` (Task 8), `buildConflictPrompt` (Task 3), `resolveTicketWorktree` (`ticketCwd.ts`), `getIssueDescription` (Task 1).
- Produces:

```ts
// qaVerdict.ts
export type QaArg = "approve-local" | "approve-mr" | "reject";
export interface QaVerdictDeps {
  merge: (mode: MergeMode) => Promise<MergeOutcome>;
  setIssueStatus: (ticket: string, target: string) => Promise<void>;
  launchRework: (rejectReason: string) => Promise<void>;
  launchConflictFix: (detail: string) => Promise<void>;
}
export type QaVerdictResult =
  | { done: "merged"; commit: string }
  | { done: "mr-created"; url: string }
  | { done: "conflict-session" }
  | { done: "rework-session" };
export function resolveQaVerdict(input: { ticket: string; arg: QaArg; reason?: string }, deps: QaVerdictDeps): Promise<QaVerdictResult>;
// sessionKey.ts
export function conflictSessionName(ticket: string): string; // "mojito-<ticket>-conflict"
// launch.ts
export interface ConflictLaunchRequest { ticket: string; projectName: string | null; title: string; description: string; model: string; effort: Effort; }
export function launchConflictSession(req: ConflictLaunchRequest, deps: LaunchDeps): Promise<{ ok: true; meta: SessionMeta } | { ok: false; reason: "duplicate" | "no-repo"; id?: string }>;
```

- [ ] **Step 1: Rewrite `tests/server/qaVerdict.test.ts`** with stub deps recording calls. Cases: approve-local + `merged` → `setIssueStatus(ticket, "Done")`, result `{done:"merged"}`; approve-mr + `mr-created` → Done + url; approve-local + `conflict` → `launchConflictFix` called, **no** status write; merge `error` → throws `QaVerdictError`; reject without reason → throws `QaVerdictError`; reject with reason → `setIssueStatus(ticket, "In Progress")` then `launchRework("<reason>")`, **no comment anywhere**. Run — FAIL.
- [ ] **Step 2: Implement `qaVerdict.ts`:**

```ts
import type { MergeMode, MergeOutcome } from "./merge.js";

export type QaArg = "approve-local" | "approve-mr" | "reject";
export const QA_ARGS: readonly QaArg[] = ["approve-local", "approve-mr", "reject"];

export class QaVerdictError extends Error {}

export interface QaVerdictDeps {
  merge: (mode: MergeMode) => Promise<MergeOutcome>;
  setIssueStatus: (ticket: string, target: string) => Promise<void>;
  launchRework: (rejectReason: string) => Promise<void>;
  launchConflictFix: (detail: string) => Promise<void>;
}

export type QaVerdictResult =
  | { done: "merged"; commit: string }
  | { done: "mr-created"; url: string }
  | { done: "conflict-session" }
  | { done: "rework-session" };

/**
 * Resolve a To QA verdict. Approve runs the server-side merge (zero tokens on the
 * clean path) and only launches a session on rebase conflict; reject sends the reason
 * to the next work session through its context file — nothing is posted to Linear.
 */
export async function resolveQaVerdict(
  input: { ticket: string; arg: QaArg; reason?: string },
  deps: QaVerdictDeps,
): Promise<QaVerdictResult> {
  const { ticket, arg, reason } = input;
  if (arg === "reject") {
    const trimmed = (reason ?? "").trim();
    if (!trimmed) throw new QaVerdictError("rejection reason required");
    await deps.setIssueStatus(ticket, "In Progress");
    await deps.launchRework(trimmed);
    return { done: "rework-session" };
  }
  const outcome = await deps.merge(arg === "approve-local" ? "local" : "mr");
  switch (outcome.status) {
    case "merged":
      await deps.setIssueStatus(ticket, "Done");
      return { done: "merged", commit: outcome.commit };
    case "mr-created":
      await deps.setIssueStatus(ticket, "Done");
      return { done: "mr-created", url: outcome.url };
    case "conflict":
      await deps.launchConflictFix(outcome.detail);
      return { done: "conflict-session" };
    case "error":
      throw new QaVerdictError(`merge failed: ${outcome.detail}`);
  }
}
```

- [ ] **Step 3: `ticketVerdict.ts`.** Validate `arg` against `QA_ARGS`; pass the `QaVerdictResult` through: `{ ok: true; result: QaVerdictResult }`. Keep the To QA live-status check and the stale-session supersede.
- [ ] **Step 4: `conflictSessionName`** in `sessionKey.ts` (mirror `rebaseSessionName`), and `launchConflictSession` in `launch.ts`: same shape as `launchSession` but id from `conflictSessionName`, context `{ identifier, statusName: "To QA", title, project: projectName, labels: [], description }`, prompt from `buildConflictPrompt`, `kind: "ticket"`, `launchStatus: "To QA"`. Add a launch test asserting the command contains the conflict prompt text and the id ends in `-conflict`.
- [ ] **Step 5: Wire the route** (`src/app/api/tickets/[id]/verdict/route.ts`):

```ts
const worktree = resolveTicketWorktree(cfg.projectsPath, id, body.projectName ?? null);
const repoRoot = resolveTicketCwd(cfg.projectsPath, id, body.projectName ?? null); // root when no worktree
// merge dep: requires a worktree distinct from the root
merge: (mode) => {
  if (!worktree || !repoRoot || worktree === repoRoot) return Promise.resolve({ status: "error", detail: "no worktree for ticket" } as const);
  return mergeTicketBranch({ worktree, repoRoot: repoRootOf(worktree) ?? repoRoot, mode });
},
```

  where `repoRootOf(worktree)` is the project path from `resolvePathForProject(loadProjectMap(cfg.projectsPath), body.projectName)` (the main checkout, not the worktree). The UI must send `projectName` and `title` in the verdict body — update `submitVerdict` in `LaunchSheet.tsx` accordingly. `launchRework`: fetch description via `getIssueDescription`, then `launchSession({ ticket: id, status: "In Progress", model: defaultModelForStatus("In Progress"), effort: defaultEffortForStatus("In Progress"), projectName, title, labels: [], description, rejectReason })` with the standard tmux deps; if a session with that id exists in the registry, `supersedeSession` it first. `launchConflictFix`: same description fetch + `launchConflictSession` (supersede an existing conflict session first). Map `QaVerdictError` → 400, other errors → 422, and include `result` in the 200 body.
- [ ] **Step 6: UI.** `QaVerdictButtons.tsx`: replace the single Approve with two buttons — `Approve · merge` → `onApprove("approve-local")`, `Approve · MR` → `onApprove("approve-mr")`; Reject unchanged (prompts for a reason). In `LaunchSheet.tsx`: `submitVerdict` takes the new args and sends `{ arg, reason?, projectName: ticket.project, title: ticket.title }`; delete `startRebase` and the "Rebase onto default branch" button (lines 53-72, 170-174) and the `rebaseSessionName` import.
- [ ] **Step 7: Verify.** `npx tsc --noEmit && npx vitest run` — PASS.
- [ ] **Step 8: Commit.** `git commit -am "feat(qa): approve merges server-side, reject launches rework with reason in context"`

---

### Task 10: New ticket via API (no session)

**Files:**
- Modify: `src/app/api/tickets/route.ts` (add POST), `src/server/limeProjects.ts` (add `teamKeyForProject`), `src/components/NewTicketSheet.tsx`, `src/app/page.tsx` (NewTicketSheet callback), `src/app/api/sessions/route.ts` (remove `new-ticket` branch)
- Delete from `src/server/launch.ts`: `NewTicketLaunchRequest`, `buildNewTicketClaudeCommand`, `launchNewTicketSession`; from `src/server/launchContext.ts`: `NewTicketContext`, `writeNewTicketContext`
- Test: `tests/server/limeProjects.test.ts` (teamKeyForProject), a new route-level test is not needed (route logic is thin); update `tests/server/launch.test.ts`/`launchContext` tests to drop the removed functions

**Interfaces:**
- Consumes: `createIssue`, `uploadImage` (linear.ts), `validateImages` (imageUpload.ts), `loadProjectMap`.
- Produces: `teamKeyForProject(map: ProjectMap, projectName: string | null): string | null` — the team key whose `projects` map contains the name; falls back to the map's first key; null for an empty map. POST `/api/tickets` body `{ title, brief, projectName, images }` → 201 `{ identifier }`.

- [ ] **Step 1: Failing tests for `teamKeyForProject`:** name found under a team → that key; name not found / null → first key; empty map → null.
- [ ] **Step 2: Implement** in the projects module:

```ts
export function teamKeyForProject(map: ProjectMap, projectName: string | null): string | null {
  if (projectName) {
    for (const [key, entry] of Object.entries(map)) {
      if (typeof entry !== "string" && entry.projects && Object.prototype.hasOwnProperty.call(entry.projects, projectName)) return key;
    }
  }
  return Object.keys(map)[0] ?? null;
}
```

- [ ] **Step 3: POST handler** in `src/app/api/tickets/route.ts`:

```ts
export async function POST(req: Request) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  let body;
  try { body = await req.json(); } catch { return new NextResponse("bad json", { status: 400 }); }
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const brief = typeof body.brief === "string" ? body.brief.trim() : "";
  if (!title) return NextResponse.json({ error: "empty title" }, { status: 400 });
  const parsed = validateImages(body.images);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  let imageUrls: string[];
  try {
    imageUrls = await Promise.all(parsed.files.map((f) => uploadImage(cfg.linearApiKey, f)));
  } catch {
    return NextResponse.json({ error: "image upload failed" }, { status: 502 });
  }
  const teamKey = teamKeyForProject(loadProjectMap(cfg.projectsPath), body.projectName ?? null);
  if (!teamKey) return NextResponse.json({ error: "no team configured" }, { status: 422 });
  const description = imageUrls.length ? `${brief}\n\n${imageUrls.map((u) => `![](${u})`).join("\n")}` : brief;
  try {
    const created = await createIssue(cfg.linearApiKey, {
      teamKey, title, description, projectName: body.projectName ?? null,
    });
    return NextResponse.json(created, { status: 201 });
  } catch {
    return NextResponse.json({ error: "issue creation failed" }, { status: 502 });
  }
}
```

- [ ] **Step 4: UI.** `NewTicketSheet.tsx`: add a `title` state + text input above Description; remove the model/effort selectors and their state; `create()` POSTs to `/api/tickets` with `{ title, brief, projectName, images }`; disable the button until `title.trim()` is non-empty; `onCreated` becomes `() => void` (no `SessionMeta`) — update the prop type and the caller in `page.tsx` to refresh the ticket list (call the existing refetch from `useTickets`; if none is exposed, closing the sheet is enough — the 45s poll picks it up — but prefer an immediate refetch if the hook exposes one).
- [ ] **Step 5: Remove the session path.** Delete the `new-ticket` branch in `src/app/api/sessions/route.ts`, then `launchNewTicketSession`/`buildNewTicketClaudeCommand`/`NewTicketLaunchRequest` from `launch.ts`, then `writeNewTicketContext`/`NewTicketContext` from `launchContext.ts`. Grep `LIME_NEW_CONTEXT|lime-new|new-ticket` — only historical docs may remain.
- [ ] **Step 6: Verify.** `npx tsc --noEmit && npx vitest run` — PASS.
- [ ] **Step 7: Commit.** `git commit -am "feat(tickets): create Linear issues directly via API"`

---

### Task 11: Remove the rebase session kind

**Files:**
- Modify: `src/server/types.ts` (drop `"rebase"` from the kind union), `src/server/sidecar.ts` (legacy map: `"rebase"` → `"custom"`), `src/server/hookHandler.ts` (drop `"rebase"` from the guard + comment), `src/server/sessionKey.ts` (delete `rebaseSessionName`), `src/server/launch.ts` (delete `RebaseLaunchRequest`, `buildRebaseClaudeCommand`, `launchRebaseSession`), `src/app/api/sessions/route.ts` (delete the `rebase` branch), `src/components/SessionList.tsx` (drop the `rebase` kind chip)
- Test: update `tests/server/{launch,sessionKey,hookHandler,sidecar}.test.ts` and `tests/lib/*` accordingly; add the sidecar legacy case (`kind: "rebase"` reads back as `"custom"`)

- [ ] **Step 1:** Add the failing sidecar legacy-mapping test, then make all deletions above in one sweep. `grep -rn "rebase" src/ tests/` afterwards: the only legitimate hits left are `merge.ts` (git rebase), the conflict prompt, and historical docs.
- [ ] **Step 2: Verify.** `npx tsc --noEmit && npx vitest run` — PASS.
- [ ] **Step 3: Commit.** `git commit -am "refactor(server): remove the rebase session kind"`

---

### Task 12: Projects config rename (drop the lime name)

**Files:**
- Rename: `src/server/limeProjects.ts` → `src/server/projects.ts`; `tests/server/limeProjects.test.ts` → `tests/server/projects.test.ts`
- Modify: `src/server/config.ts`, all importers (`launch.ts`, `ticketCwd.ts`, `projectStack.ts`, `docTarget.ts`, `src/app/api/projects/route.ts`, verdict/tickets routes from Tasks 9-10)
- Test: `tests/server/config.test.ts` (path-resolution chain; create if absent)

**Interfaces:**
- Produces: `resolveProjectsPath(env, exists?): string` in `config.ts` with precedence: `MOJITO_PROJECTS` env → `LIME_PROJECTS` env (legacy, honored one release) → `~/.config/mojito/projects.json` if it exists → `~/.claude/lime-projects.json`.

- [ ] **Step 1: Failing config tests:** each precedence rung, with an injected `exists` stub.
- [ ] **Step 2: Implement** in `config.ts`:

```ts
import { existsSync } from "node:fs";

export function resolveProjectsPath(
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = existsSync,
): string {
  if (env.MOJITO_PROJECTS) return env.MOJITO_PROJECTS;
  if (env.LIME_PROJECTS) return env.LIME_PROJECTS; // legacy env, honored for one release
  const modern = join(homedir(), ".config", "mojito", "projects.json");
  if (exists(modern)) return modern;
  return join(homedir(), ".claude", "lime-projects.json"); // legacy lime location
}
```

  and use `projectsPath: resolveProjectsPath(env)` in `loadConfig`. `git mv` the module + test, fix imports (`@/server/limeProjects` → `@/server/projects`), update `docTarget.ts`'s comment about `/lime-design` creating worktrees (worktrees are now created by the work session — the re-resolution logic stays).
- [ ] **Step 3: Verify + migrate the live file.** `npx tsc --noEmit && npx vitest run` — PASS. Then copy the real config: `mkdir -p ~/.config/mojito && cp ~/.claude/lime-projects.json ~/.config/mojito/projects.json`.
- [ ] **Step 4: Commit.** `git commit -am "refactor(config): projects map moves to ~/.config/mojito/projects.json"`

---

### Task 13: Remove diff-based review scaling (dead with the review stages)

**Files:**
- Delete: `src/server/reviewScale.ts`, `src/server/scaleSettings.ts`, `src/lib/reviewScale.ts`, their tests, and the review-scale settings API route (locate with `grep -rn "reviewScale\|scaleSettings\|review-scale\|autoScale\|scaledFrom" src/ tests/`)
- Modify: `src/server/launch.ts` (delete the scaling block, lines 73-96, and the `changedLines` dep), `src/server/types.ts` (delete `scaledFrom`), `src/components/SessionList.tsx` (delete the `⤵` scaled chip), `src/components/SettingsSheet.tsx` (delete the review-scale section)

- [ ] **Step 1:** Make the deletions; the grep above must come back empty (excluding historical docs).
- [ ] **Step 2: Verify.** `npx tsc --noEmit && npx vitest run` — PASS.
- [ ] **Step 3: Commit.** `git commit -am "refactor: remove review diff-scaling (review stages no longer exist)"`

---

### Task 14: Documentation rewrite

**Files:**
- Modify: `CLAUDE.md`, `README.md`

- [ ] **Step 1: Replace `CLAUDE.md`** with (keep the Tests section, drop everything lime):

```markdown
# Mojito

Mojito is a Next.js + TypeScript app (GUI + local server) that manages Linear tickets
per project and runs them through a collapsed lifecycle:
`Backlog/Todo → In Progress → To QA → Done`.

Mojito owns the whole lifecycle — there is no external plugin:

- **Prompts**: `src/server/prompts.ts` builds the full session prompt (work phase,
  conflict resolution) from templates in `src/server/prompts/`. Sessions are spawned as
  detached tmux sessions running `claude … '<prompt>'`.
- **Linear**: `src/server/linear.ts` is a direct GraphQL client. Mojito writes issue
  creation, status transitions, and assignee — never comments. **Spawned sessions never
  touch Linear** (no MCP, no API); their prompt forbids it.
- **Session context**: the launcher writes `<stateDir>/context/<id>.json`
  (`{identifier, statusName, title, project, labels, description, rejectReason?}`);
  the prompt embeds the path.
- **Outcome channel**: the session's last action is writing
  `<stateDir>/results/<id>.json` (`{outcome: "ready-for-qa" | "blocked", notes}`).
  The Stop hook reads it (`src/server/hookHandler.ts`) and Mojito moves the status.
- **QA gate**: approve runs the server-side rebase+merge (`src/server/merge.ts`,
  zero tokens on the clean path; a Claude session only on conflict); reject launches
  the rework session with the reason in its context file.
- **Status model**: `src/server/statusModel.ts` is authoritative; `src/lib/status.ts`
  mirrors it for presentation and a sync-guard test ties them together.
- **Projects map**: `~/.config/mojito/projects.json` (Linear team key → project name →
  repo path); overridable via `MOJITO_PROJECTS`.

## Tests

`npx tsc --noEmit && npx vitest run` — server logic lives under `src/server/`, tests under
`tests/server/`. The tmux integration test is skipped when `tmux` is unavailable.
```

- [ ] **Step 2: README.md** — update the opening description (lines 4-6) to match: launches and monitors Claude Code ticket sessions with Mojito-owned prompts; no lime references.
- [ ] **Step 3:** `grep -rni "lime" src/ tests/ CLAUDE.md README.md` — remaining hits must be only the legacy-compat spots (sidecar kind mapping comment, `LIME_PROJECTS` env fallback, legacy path) and historical docs under `docs/`.
- [ ] **Step 4: Commit.** `git commit -am "docs: Mojito-native lifecycle, drop the lime contract"`

---

### Task 15: Rollout (operational — no code)

Run these in order, after all code tasks are merged and deployed (restart the systemd user service so the new server is live).

- [ ] **Step 1: Linear workspace.** In team RIC: create workflow state `In Progress` (type *started*) if absent. Move open tickets: RIC-134 (To Code) → In Progress. Cancel RIC-170, RIC-171, RIC-173 (superseded by this refactor). Then delete workflow states `To Code`, `To Review`, `To Merge` (Linear requires them to be empty first).
- [ ] **Step 2: lime plugin.** Uninstall via `/plugin` in Claude Code; verify with `ls ~/.claude/plugins/cache/lime/` (must be gone or orphaned-only). Archive the `ricventu/lime` GitHub repo (manual, on GitHub).
- [ ] **Step 3: Smoke test.** From the UI: create a ticket (New ticket → appears in Linear, no session spawned); launch it (ticket moves to In Progress; tmux session running with the work prompt); simulate completion by writing `{"outcome":"ready-for-qa","notes":"smoke"}` to `~/.mojito-state/results/<id>.json` and firing a Stop hook, verify the ticket lands at To QA; approve on a ticket with a clean branch, verify the merge and Done.
- [ ] **Step 4:** Update the auto-memory index entries that reference lime workflows if they no longer apply.

---

## Self-Review Notes

- Spec coverage: status model (T7, T15), prompt builder + no-Linear sessions (T3, T5), outcome channel (T2, T6), QA gate + server-side merge + conflict session + reject-with-context (T8, T9), new ticket via API (T10), removals/renames (T4, T11, T12, T13), CLAUDE.md/README (T14), workspace migration + plugin uninstall + ticket cancellation (T15). Single-session decision needs no task — it's the shape of the work prompt (T3).
- Deliberate deviation from the spec's letter: prompt templates are `.ts` constants instead of `.md` files (Next.js bundling reliability); recorded in T3.
- Interim states: between T5 and T6 a launched session cannot advance a ticket (hook still polls Linear, sessions no longer write it). Acceptable — nothing deploys until rollout (T15), and tests stay green throughout.
