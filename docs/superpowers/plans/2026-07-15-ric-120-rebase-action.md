# To-QA rebase action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-click "Rebase" action, shown for a Linear ticket in **To QA** with no active session, that launches a claude session running a new `/lime-rebase <ID>` lime command to rebase the ticket's worktree branch onto the default branch and — if the rebase changed code — run a code review with up to two inline fix cycles.

**Architecture:** Cross-repo, **lime first, then Mojito** (Mojito depends on lime, never the reverse — see CLAUDE.md). lime gains a standalone `/lime-rebase` command that is Stage 5's "first part" minus the merge, terminal state stays at To QA. Mojito adds a new `kind: "rebase"` session launched via `/api/sessions`, plus a gated button in the To-QA `LaunchSheet`.

**Tech Stack:** lime = a Claude Code plugin skill (Markdown `SKILL.md`). Mojito = Next.js + TypeScript, server logic under `src/server/`, Vitest tests under `tests/server/` and `tests/lib/`. Test command: `npx tsc --noEmit && npx vitest run`.

## Global Constraints

- All code artifacts in English (identifiers, comments, commit messages, docs).
- lime changes require a version bump in `.claude-plugin/plugin.json` and a **manual** plugin-cache rebuild via `/plugin` in Claude Code — editing lime source has no runtime effect until then.
- Linear comments posted by lime must be **command-agnostic** — never mention "lime", "lime-next", "lime-rebase", or any slash command.
- Session name for a rebase session: `mojito-<ticket>-rebase` (must not collide with the `-to-qa` gate session).
- Rebase session: `kind: "rebase"`, `launchStatus: "To QA"`, `autoAdvance: false`, defaults model `opus` / effort `xhigh`.
- `/lime-rebase` is **To-QA-only** and never auto-chains into another stage.
- Follow TDD (test first) for all Mojito server/lib logic. Commit after each task.

---

### Task 1: lime — add the `/lime-rebase` command

This task lives in the **lime repo** (`/Users/ricventu/code/Lime/lime`), on its own branch. It has no automated tests (it is a Markdown skill); its deliverable is the new command, a version bump, a README row, and a cross-reference note in Stage 5. The runtime cache rebuild is a manual step called out at the end.

**Files:**
- Create: `/Users/ricventu/code/Lime/lime/skills/lime-rebase/SKILL.md`
- Modify: `/Users/ricventu/code/Lime/lime/.claude-plugin/plugin.json` (version `0.15.0` → `0.16.0`)
- Modify: `/Users/ricventu/code/Lime/lime/README.md` (add a row / short section for `/lime-rebase`)
- Modify: `/Users/ricventu/code/Lime/lime/skills/lime-next/SKILL.md` (one-line cross-reference note in Stage 5)

**Interfaces:**
- Produces: the shell command Mojito will spawn — `claude … '/lime-rebase <ID>'` — and the launch-context contract it reads (`{ identifier, statusName: "To QA", title, project, labels }`, same file Mojito already writes).

- [ ] **Step 1: Write `skills/lime-rebase/SKILL.md`.**

Frontmatter + body. The body reuses lime-next's resolution logic and Stage 5 steps 2–3, minus the merge. Full content:

```markdown
---
name: lime-rebase
description: Use when a Linear ticket is in To QA and you want to rebase its worktree branch onto the default branch before QA — fetches the default branch (best-effort, tolerates a remote-less repo), rebases, and if the rebase changed code runs a code review with up to two inline fix cycles. Stays at To QA on success; escalates to To Code only if review findings can't be fixed. Trigger via /lime-rebase <TICKET-ID>. Never merges.
---

# Lime — Rebase a To-QA ticket branch

Rebase ONE Linear ticket's worktree branch onto the default branch while it waits in
**To QA**, then stop. This is lime's To-Merge "first part" (rebase + conditional review +
inline fixes) WITHOUT the merge. It never advances the ticket forward; the only status
change it makes is escalating to **To Code** when review findings cannot be fixed inline.

**One rebase per invocation. Never chain into a merge or another stage.**

## Prerequisites

1. **Linear MCP** connected for the status write (an escalation to To Code) and the
   summary comment. The dispatch read may come from `LIME_SESSION_CONTEXT`.
2. **superpowers** `requesting-code-review` must be available. If missing, STOP and report.

## Step 1 — Resolve the ticket

1. Require a TICKET-ID argument (e.g. `/lime-rebase RIC-120`). If absent, try
   `git branch --show-current` for a Linear identifier. If neither yields an ID, STOP:
   "Pass a TICKET-ID — e.g. `/lime-rebase ABC-123`."
2. **Read the launch context before touching Linear.** If `LIME_SESSION_CONTEXT` is set,
   the file exists, and its `identifier` matches the resolved ticket, take the current
   **status** from `statusName` and the `title`/`project`/`labels` from it — do NOT call
   `get_issue`. Otherwise fall back to Linear `get_issue` for the status, title, team,
   project, and branch name.
3. **Print the session rename command NOW**, on its own line:
   `/rename <project>/<TICKET-ID> [To QA] - <title>`
   (`<project>` is the Linear project name, or the repo dir name if none). The user renames
   the session while the rebase runs.

## Step 1.5 — Resolve the repo and enter the worktree

Same resolution as lime-next: read `~/.claude/lime-projects.json`, resolve the repo by team
key / project (fall back to the current repo when unmapped and inside a repo, else STOP).
Then find the ticket's worktree:

1. `git -C <repo> worktree list --porcelain` and pick the entry whose branch is the
   ticket's branch. If none matches, STOP: "No worktree for `<branch>` — the ticket must
   have reached To Code first."
2. `cd "<worktree-path>"` and **verify** — STOP if either fails:
   - `git rev-parse --show-toplevel` equals `<worktree-path>` (inside the worktree, not the
     main checkout), and
   - `git branch --show-current` equals `<branch>` and is NOT the repo's default branch.

## Step 2 — Status guard

If the current status is NOT **To QA**, STOP and report: "Ticket is <status>; the rebase
action only runs at To QA." Do not change anything.

## Step 3 — Rebase onto the default branch

Mirrors lime-next Stage 5 steps 2–3, remote-tolerant:

1. Determine the default branch of the repo.
2. **Fetch is best-effort.** If `git remote` lists a remote tracking the default branch,
   `git fetch <remote>`. If there is NO remote (`git remote` is empty — a local-only repo),
   skip the fetch and rebase onto the local default branch.
3. `PRE=$(git rev-parse HEAD^{tree})`.
4. `git rebase <default-branch>`.
   - **On conflict:** `git rebase --abort`, post a comment that the rebase conflicts must be
     resolved manually before it can proceed, STAY at **To QA**, and STOP. Do NOT merge.
5. `POST=$(git rev-parse HEAD^{tree})`.

## Step 4 — Review only if the rebase changed content

- **`PRE == POST`** (branch already current — nothing changed): post a comment noting the
  branch was already up to date, STAY at **To QA**, and STOP.
- **`PRE != POST`**: invoke `superpowers:requesting-code-review` on `<default-branch>..HEAD`.
  - **Review clean** → post a comment (rebased, content changed, review clean), STAY at
    **To QA**, and STOP.
  - **Blocking findings** → up to **2** inline fix→review cycles:
    1. Apply targeted fixes for the findings and commit them on the ticket branch.
    2. Re-run a fresh `superpowers:requesting-code-review`.
    - **Re-review clean** → post a comment listing the findings and the fixes applied,
      STAY at **To QA**, and STOP. (New code was written — a human re-QAs it.)
    - **Still blocking after 2 cycles, or findings need real rework** (a design/plan change,
      not a targeted fix) → post the findings as a comment, set status to **To Code**, and
      STOP. Implementation addresses them and the ticket flows To Review → To QA again.

## Step 5 — Linear sync

- **Set status** (only in the escalation case): resolve **To Code** via
  `list_issue_statuses` for the ticket's team, then `save_issue`. If it doesn't resolve,
  STOP and report to create the state first.
- **Post comment:** exactly one comment per invocation via `save_comment`, command-agnostic
  wording (never name lime or any slash command). Record the rebase outcome (no change /
  rebased + review clean / rebased + inline fixes applied + re-review clean / escalated to
  re-implementation with the findings).
- Always tell the user the outcome and the status (still To QA, or moved to To Code).

## Guard summary

- No TICKET-ID and no branch identifier → STOP.
- Not at To QA → STOP (To-QA-only).
- Runs inside the ticket worktree only (branch guard; refuse the default branch / main
  checkout).
- Rebase conflict → `rebase --abort`, stay To QA, report.
- Rebase changed nothing → comment, stay To QA.
- Rebase changed content → inline review; clean/fixed → stay To QA; unfixable → To Code.
- Never merges, never auto-chains.
```

- [ ] **Step 2: Bump the plugin version.**

Edit `/Users/ricventu/code/Lime/lime/.claude-plugin/plugin.json`, `"version": "0.15.0"` → `"version": "0.16.0"`.

- [ ] **Step 3: Add a README row for the new command.**

In `/Users/ricventu/code/Lime/lime/README.md`, under the lifecycle table (or an "Ad-hoc commands" note), add:

```markdown
### `/lime-rebase <TICKET-ID>`

Rebase a ticket's worktree branch onto the default branch **while it waits in To QA**
(the "first part" of To Merge, without the merge). Fetches the default branch if a remote
exists (tolerates a local-only repo), rebases, and if the rebase changed code runs a code
review with up to two inline fix cycles. Stays at To QA on success; escalates to To Code
only when review findings can't be fixed inline. Never merges.
```

- [ ] **Step 4: Add a cross-reference note in Stage 5.**

In `/Users/ricventu/code/Lime/lime/skills/lime-next/SKILL.md`, at the top of Stage 5's rebase
steps (step 2), add a one-line note (does not change behavior):

```markdown
> Note: the rebase + conditional-review + inline-fix logic below is mirrored by the
> standalone `/lime-rebase` command (used to rebase a To-QA branch without merging). Keep the
> two in sync; a future ticket will unify them into a shared block.
```

- [ ] **Step 5: Commit (lime repo).**

```bash
cd /Users/ricventu/code/Lime/lime
git add skills/lime-rebase/SKILL.md .claude-plugin/plugin.json README.md skills/lime-next/SKILL.md
git commit -m "feat(lime): add /lime-rebase command for rebasing a To-QA branch"
```

- [ ] **Step 6: MANUAL — rebuild the plugin cache.**

In Claude Code, run `/plugin` and update the `lime` plugin so the new version lands in
`~/.claude/plugins/cache/lime/lime/0.16.0/`. Confirm:

```bash
ls ~/.claude/plugins/cache/lime/lime/
```
Expected: a `0.16.0` directory containing `skills/lime-rebase/SKILL.md`. This step cannot be
automated by a subagent; the human operator performs it before Mojito's rebase button is
exercised end-to-end.

---

### Task 2: Mojito — rebase session name + `kind` union

**Files:**
- Modify: `src/server/sessionKey.ts` (add `rebaseSessionName`)
- Modify: `src/server/types.ts:14` (extend `SessionMeta.kind`)
- Test: `tests/server/sessionKey.test.ts`

**Interfaces:**
- Produces: `rebaseSessionName(ticket: string): string` → `mojito-<ticket>-rebase`; `SessionMeta.kind` now includes `"rebase"`.

- [ ] **Step 1: Write the failing test.**

Append to `tests/server/sessionKey.test.ts`:

```typescript
describe("rebaseSessionName", () => {
  it("builds the rebase session name for a ticket", () => {
    expect(rebaseSessionName("RIC-120")).toBe("mojito-RIC-120-rebase");
  });
  it("does not collide with the To QA gate session name", () => {
    expect(rebaseSessionName("RIC-120")).not.toBe(tmuxName("RIC-120", "To QA"));
  });
  it("rejects a malformed ticket", () => {
    expect(() => rebaseSessionName("nonsense")).toThrow();
  });
});
```

Update the import line at the top of the file to add `rebaseSessionName`:

```typescript
import { statusSlug, tmuxName, parseIdentifier, validateTicket, customSessionName, rebaseSessionName } from "@/server/sessionKey";
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `npx vitest run tests/server/sessionKey.test.ts`
Expected: FAIL — `rebaseSessionName is not a function`.

- [ ] **Step 3: Implement `rebaseSessionName`.**

Append to `src/server/sessionKey.ts`:

```typescript
export function rebaseSessionName(ticket: string): string {
  validateTicket(ticket);
  return `mojito-${ticket}-rebase`;
}
```

- [ ] **Step 4: Extend the `kind` union.**

In `src/server/types.ts`, change line 14:

```typescript
  kind: "lime" | "custom" | "rebase"; // "lime" = ticket-lifecycle; "custom" = standalone; "rebase" = one-off To-QA rebase
```

- [ ] **Step 5: Run the tests to verify they pass.**

Run: `npx tsc --noEmit && npx vitest run tests/server/sessionKey.test.ts`
Expected: PASS (typecheck clean, all sessionKey tests green).

- [ ] **Step 6: Commit.**

```bash
git add src/server/sessionKey.ts src/server/types.ts tests/server/sessionKey.test.ts
git commit -m "feat(mojito): add rebaseSessionName and rebase session kind (RIC-120)"
```

---

### Task 3: Mojito — `launchRebaseSession`

**Files:**
- Modify: `src/server/launch.ts` (add `RebaseLaunchRequest`, `buildRebaseClaudeCommand`, `launchRebaseSession`)
- Test: `tests/server/launch.test.ts`

**Interfaces:**
- Consumes: `rebaseSessionName` (Task 2), `writeLaunchContext`, `defaultResolveCwd`, `LaunchDeps`, `logfilePath`, `buildHookSettings`.
- Produces:
  - `buildRebaseClaudeCommand(req: RebaseLaunchRequest, settingsPath: string, contextPath: string): string`
  - `launchRebaseSession(req: RebaseLaunchRequest, deps: LaunchDeps): Promise<{ ok: true; meta: SessionMeta } | { ok: false; reason: "duplicate" | "no-repo"; id?: string }>`
  - `interface RebaseLaunchRequest { ticket: string; projectName: string | null; title: string; labels: string[]; model: string; effort: Effort }`

- [ ] **Step 1: Write the failing tests.**

Append to `tests/server/launch.test.ts` (reuses the `deps()` helper and `dir` from the file):

```typescript
import { launchRebaseSession, buildRebaseClaudeCommand } from "@/server/launch";

const baseRebaseReq = {
  ticket: "RIC-120", projectName: "Mojito", title: "action per fare rebase",
  labels: [] as string[], model: "opus", effort: "xhigh" as const,
};

describe("buildRebaseClaudeCommand", () => {
  it("runs /lime-rebase for the ticket with a launch context prefix", () => {
    const cmd = buildRebaseClaudeCommand(baseRebaseReq, "/s/x.json", "/c/x.json");
    expect(cmd).toMatch(/^LIME_SESSION_CONTEXT='\/c\/x.json' claude /);
    expect(cmd).toContain("--model 'opus' --effort 'xhigh'");
    expect(cmd).toContain("--settings '/s/x.json'");
    expect(cmd).toContain("'/lime-rebase RIC-120'");
    expect(cmd).not.toContain("/lime-next");
  });
});

describe("launchRebaseSession", () => {
  it("launches a rebase-kind session with autoAdvance off at To QA", async () => {
    const d = deps();
    const res = await launchRebaseSession(baseRebaseReq, d);
    expect(res.ok).toBe(true);
    const meta = (res as { ok: true; meta: SessionMeta }).meta;
    expect(meta).toMatchObject({
      kind: "rebase", id: "mojito-RIC-120-rebase", ticket: "RIC-120",
      launchStatus: "To QA", autoAdvance: false, state: "starting", cwd: "/code/lime",
    });
    expect(d.newSession).toHaveBeenCalledWith(
      "mojito-RIC-120-rebase", "/code/lime", expect.stringContaining("'/lime-rebase RIC-120'"));
  });

  it("writes a launch context with statusName To QA", async () => {
    const { readFileSync } = await import("node:fs");
    const d = deps();
    await launchRebaseSession(baseRebaseReq, d);
    const p = join(dir, "context", "mojito-RIC-120-rebase.json");
    expect(JSON.parse(readFileSync(p, "utf8"))).toEqual({
      identifier: "RIC-120", statusName: "To QA",
      title: "action per fare rebase", project: "Mojito", labels: [],
    });
  });

  it("refuses a duplicate", async () => {
    const d = deps({ hasSession: vi.fn(async () => true) });
    const res = await launchRebaseSession(baseRebaseReq, d);
    expect(res).toMatchObject({ ok: false, reason: "duplicate", id: "mojito-RIC-120-rebase" });
  });

  it("refuses when no repo resolves", async () => {
    const d = deps({ resolveCwd: () => null });
    const res = await launchRebaseSession(baseRebaseReq, d);
    expect(res).toMatchObject({ ok: false, reason: "no-repo" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `npx vitest run tests/server/launch.test.ts`
Expected: FAIL — `launchRebaseSession`/`buildRebaseClaudeCommand` not exported.

- [ ] **Step 3: Implement in `src/server/launch.ts`.**

Add `rebaseSessionName` to the existing `sessionKey.js` import at the top:

```typescript
import { tmuxName, parseIdentifier, validateTicket, statusSlug, customSessionName, rebaseSessionName } from "./sessionKey.js";
```

Append at the end of the file:

```typescript
export interface RebaseLaunchRequest {
  ticket: string;
  projectName: string | null;
  title: string;
  labels: string[];
  model: string;
  effort: Effort;
}

export function buildRebaseClaudeCommand(
  req: RebaseLaunchRequest,
  settingsPath: string,
  contextPath: string,
): string {
  const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  return (
    `LIME_SESSION_CONTEXT=${q(contextPath)} ` +
    `claude --model ${q(req.model)} --effort ${q(req.effort)} ` +
    `--settings ${q(settingsPath)} ${q(`/lime-rebase ${req.ticket}`)}`
  );
}

/**
 * Launch a one-off session that rebases the ticket's worktree branch onto the default
 * branch (the To-Merge "first part", no merge). Distinct session name so it never collides
 * with the To-QA gate session; autoAdvance is always off (this is not a lifecycle handoff).
 */
export async function launchRebaseSession(
  req: RebaseLaunchRequest,
  deps: LaunchDeps,
): Promise<{ ok: true; meta: SessionMeta } | { ok: false; reason: "duplicate" | "no-repo"; id?: string }> {
  validateTicket(req.ticket);
  const id = rebaseSessionName(req.ticket);

  if (await deps.hasSession(id)) return { ok: false, reason: "duplicate", id };

  const resolveCwd = deps.resolveCwd ?? defaultResolveCwd(deps.projectsPath);
  const cwd = resolveCwd(req.ticket, req.projectName);
  if (!cwd) return { ok: false, reason: "no-repo" };

  const settingsDir = join(deps.stateDir, "settings");
  mkdirSync(settingsDir, { recursive: true, mode: 0o700 });
  const settingsPath = join(settingsDir, `${id}.json`);
  writeFileSync(settingsPath, JSON.stringify(buildHookSettings(id, deps.port, deps.token), null, 2), {
    mode: 0o600,
  });
  chmodSync(settingsPath, 0o600); // mode on writeFileSync is ignored if the file pre-existed

  const contextPath = writeLaunchContext(deps.stateDir, id, {
    identifier: req.ticket,
    statusName: "To QA",
    title: req.title,
    project: req.projectName,
    labels: req.labels,
  });

  const command = buildRebaseClaudeCommand(req, settingsPath, contextPath);
  await deps.newSession(id, cwd, command);
  await deps.pipePane(id, logfilePath(deps.stateDir, id));

  const meta: SessionMeta = {
    kind: "rebase",
    id,
    ticket: req.ticket,
    launchStatus: "To QA",
    model: req.model,
    effort: req.effort,
    autoAdvance: false,
    state: "starting",
    cwd,
    createdAt: (deps.nowIso ?? (() => new Date().toISOString()))(),
    projectName: req.projectName,
    title: req.title,
    labels: req.labels,
  };
  deps.registry.upsert(meta);
  return { ok: true, meta };
}
```

Note: the settings-writing block intentionally mirrors `launchSession`/`launchCustomSession` (the codebase already duplicates it across launch functions rather than extracting a helper — follow that established pattern).

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `npx tsc --noEmit && npx vitest run tests/server/launch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/server/launch.ts tests/server/launch.test.ts
git commit -m "feat(mojito): add launchRebaseSession running /lime-rebase (RIC-120)"
```

---

### Task 4: Mojito — `/api/sessions` rebase branch

The Mojito codebase tests launch logic through its functions (Task 3), not through the Next
route handler (there is no sessions-route test). So this task's deliverable is verified by
`tsc` and a manual curl check, consistent with the existing route.

**Files:**
- Modify: `src/app/api/sessions/route.ts` (add a `kind: "rebase"` branch)

**Interfaces:**
- Consumes: `launchRebaseSession` (Task 3).

- [ ] **Step 1: Add the rebase branch.**

In `src/app/api/sessions/route.ts`, add `launchRebaseSession` to the import from `@/server/launch`, add `validateTicket` from `@/server/sessionKey`, and insert a rebase branch immediately after the existing `if (body.kind === "custom") { … }` block (and before the default `launchSession` call):

```typescript
  if (body.kind === "rebase") {
    try { validateTicket(body.ticket); } catch { return new NextResponse("invalid ticket", { status: 400 }); }
    const res = await launchRebaseSession(
      { ticket: body.ticket, projectName: body.projectName ?? null, title: body.title ?? "",
        labels: Array.isArray(body.labels) ? body.labels : [],
        model: body.model ?? "opus", effort: body.effort ?? "xhigh" },
      { registry: getRegistry(), stateDir: cfg.stateDir, port: cfg.port, token: cfg.token,
        projectsPath: cfg.projectsPath, hasSession, newSession, pipePane },
    );
    if (!res.ok) {
      const status = res.reason === "duplicate" ? 409 : 422;
      return NextResponse.json({ error: res.reason, id: res.id }, { status });
    }
    return NextResponse.json(res.meta, { status: 201 });
  }
```

Import lines become:

```typescript
import { launchSession, launchCustomSession, launchRebaseSession } from "@/server/launch";
import { validateTicket } from "@/server/sessionKey";
```

(The existing `trailingArg` whitelist at the top stays; a rebase launch sends no `trailingArg`, so it passes untouched.)

- [ ] **Step 2: Typecheck.**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Manual route check (optional, requires the dev server).**

With the dev server running, from a scratch dir:

```bash
curl -s -X POST localhost:8700/api/sessions -H "x-mojito-token: $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"kind":"rebase","ticket":"RIC-120","projectName":"Mojito","title":"action per fare rebase","labels":[]}'
```
Expected: `201` with a `kind:"rebase"` session meta (or `409` if one already exists).
Do NOT run this against the main checkout's dev server if it is serving the live UI — use the worktree per the repo's dev-server rule.

- [ ] **Step 4: Commit.**

```bash
git add src/app/api/sessions/route.ts
git commit -m "feat(mojito): launch a rebase session via /api/sessions kind=rebase (RIC-120)"
```

---

### Task 5: Mojito — To-QA rebase button + session rendering

**Files:**
- Modify: `src/components/LaunchSheet.tsx` (rebase button in the To-QA branch, gated on no active session; `startRebase`)
- Modify: `src/components/SessionList.tsx` (render a `kind: "rebase"` session)
- Test: `tests/lib/ticketSessionLevel.test.ts` (the gate predicate is `activeSessionLevel(...) === null`, already covered — add one asserting the null case the button depends on)

**Interfaces:**
- Consumes: `activeSessionLevel` (`src/lib/ticketSessionLevel.ts`), `apiFetch`, `rebaseSessionName` (Task 2).

- [ ] **Step 1: Add a gate-predicate test (documents the button condition).**

Append to `tests/lib/ticketSessionLevel.test.ts`:

```typescript
describe("rebase button gate", () => {
  // The To-QA rebase button shows only when the ticket has no active session.
  it("is eligible (null) when only a finished rebase session exists", () => {
    expect(activeSessionLevel("RIC-120", [s("RIC-120", "done")])).toBeNull();
  });
  it("is not eligible while a rebase session is starting/running", () => {
    expect(activeSessionLevel("RIC-120", [s("RIC-120", "starting")])).toBe("run");
  });
});
```

- [ ] **Step 2: Run to verify it passes (behavior already exists).**

Run: `npx vitest run tests/lib/ticketSessionLevel.test.ts`
Expected: PASS (this locks the predicate the UI relies on).

- [ ] **Step 3: Add the rebase launch + button to `LaunchSheet.tsx`.**

Add imports:

```typescript
import { tmuxName, rebaseSessionName } from "@/server/sessionKey";
import { activeSessionLevel } from "@/lib/ticketSessionLevel";
```

Inside the component, after `submitVerdict`, add `startRebase`:

```typescript
  // Launch a one-off session that rebases the ticket's worktree branch (To-QA action).
  const startRebase = async () => {
    const rebaseId = rebaseSessionName(ticket.identifier);
    // A finished rebase session keeps the same tmux name — clear it before relaunching,
    // else the server rejects the launch as a duplicate.
    if (sessions.some((s) => s.id === rebaseId)) {
      await apiFetch(token, `/api/sessions/${rebaseId}`, { method: "DELETE" });
    }
    const res = await apiFetch(token, "/api/sessions", {
      method: "POST",
      body: JSON.stringify({ kind: "rebase", ticket: ticket.identifier, model, effort,
        projectName: ticket.project, title: ticket.title, labels: ticket.labels }),
    });
    if (res.status === 409) { setErr("A rebase session for this ticket already exists."); return; }
    if (!res.ok) { setErr(await res.text()); return; }
    onLaunched();
    onClose();
  };

  const noActiveSession = activeSessionLevel(ticket.identifier, sessions) === null;
```

Replace the `isToQa` render branch (currently just `<QaVerdictButtons … />`) with:

```tsx
        {isToQa ? (
          <>
            <QaVerdictButtons onApprove={() => submitVerdict("approve")} onReject={(reason) => submitVerdict("reject", reason)} />
            {noActiveSession && (
              <button className="btn ghost block" style={{ marginTop: 12 }} onClick={startRebase}>
                Rebase onto default branch
              </button>
            )}
          </>
        ) : existingActive ? (
```

(`model`/`effort` already exist in component state — the To-QA branch reuses them at their defaults; the selectors aren't rendered in this branch, so the rebase launches with `opus`/`xhigh` from `defaultEffortForStatus("To QA")`… note: `defaultEffortForStatus("To QA")` is `"low"`. Override the rebase effort explicitly to `"xhigh"` in `startRebase` by sending `effort: "xhigh"` instead of the state `effort`.)

Correction — in `startRebase`, send a fixed analytical effort rather than the To-QA state default:

```typescript
      body: JSON.stringify({ kind: "rebase", ticket: ticket.identifier, model, effort: "xhigh",
        projectName: ticket.project, title: ticket.title, labels: ticket.labels }),
```

- [ ] **Step 4: Render a rebase session in `SessionList.tsx`.**

The non-custom branch already renders ticket + `launchStatus` + an auto toggle. A rebase
session has `launchStatus: "To QA"` but must NOT show the auto toggle (it never
auto-advances). Change the auto-toggle guard from `s.kind !== "custom"` to `s.kind === "lime"`,
and add a `rebase` chip. In the `.meta` block near line 110:

```tsx
                  <div className="meta">
                    <span className="chip">{s.model} · {s.effort}</span>
                    {s.kind === "rebase" && <span className="chip">rebase</span>}
                    {s.kind === "lime" && (
                      <button className={`chip toggle${s.autoAdvance ? " on" : ""}`} onClick={(e) => toggleAuto(e, s)}>
                        auto: {s.autoAdvance ? "on" : "off"}
                      </button>
                    )}
                  </div>
```

- [ ] **Step 5: Typecheck + full test run.**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS (all suites).

- [ ] **Step 6: Manual smoke (add to `docs/superpowers/smoke-checklist.md`).**

Add a checklist line: "To QA ticket with no active session shows a 'Rebase onto default
branch' button in the launch sheet; clicking it starts a `rebase` session (visible in the
session list with a `rebase` chip, no auto toggle) and the button disappears while it runs."

- [ ] **Step 7: Commit.**

```bash
git add src/components/LaunchSheet.tsx src/components/SessionList.tsx tests/lib/ticketSessionLevel.test.ts docs/superpowers/smoke-checklist.md
git commit -m "feat(mojito): To-QA rebase button and rebase session rendering (RIC-120)"
```

---

## Self-Review

**Spec coverage:**
- New `/lime-rebase` command (Stage-5 first-part parity, To-QA-only, remote-tolerant) → Task 1. ✓
- `rebaseSessionName` + `kind: "rebase"` → Task 2. ✓
- `launchRebaseSession` + `buildRebaseClaudeCommand` (context statusName "To QA", autoAdvance off, opus/xhigh) → Task 3. ✓
- `/api/sessions` rebase branch → Task 4. ✓
- To-QA `LaunchSheet` button gated on no active session + `startRebase` + SessionList rendering → Task 5. ✓
- Cross-repo procedure (lime first, version bump, manual cache rebuild, no Linear state change) → Task 1 (Steps 2, 6) + Global Constraints. ✓
- Follow-up (unify Stage 5) → documented in spec "Out of scope"; Stage-5 cross-reference note in Task 1 Step 4. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows complete code. ✓

**Type consistency:** `rebaseSessionName` (Task 2) used identically in Tasks 3 & 5; `RebaseLaunchRequest` fields (Task 3) match the route body (Task 4) and the `startRebase` POST body (Task 5); `kind: "rebase"` (Task 2) used in Tasks 3 & 5; effort fixed at `"xhigh"` consistently (Task 3 default and Task 5 explicit send). ✓

**Known nuance flagged inline:** `defaultEffortForStatus("To QA")` is `"low"`, so `startRebase` sends an explicit `effort: "xhigh"` rather than the To-QA state default (Task 5 Step 3 correction).
