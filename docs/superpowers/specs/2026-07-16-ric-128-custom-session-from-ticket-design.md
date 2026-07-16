# RIC-128 — Custom session from a ticket

**Ticket:** RIC-128 — "Creazione di sessione custom da un ticket"
**Status at design time:** Todo

## Problem

Today a ticket can only be launched as a **lime** session (`claude … /lime-next <TICKET>`),
which drives the full ticket lifecycle. Sometimes the user wants to open an ad-hoc,
free-form claude session *scoped to a ticket* — to poke at the code, inspect the branch, or
do manual work — without running the lifecycle.

Mojito already has **custom** (bare `claude`) sessions from RIC-115, but they are scoped to a
*project* (they open at the mapped repo root) and carry no ticket context. RIC-128 fills the
gap: launch a bare custom session **from a ticket**, opening it in the ticket's worktree when
one exists.

## Goal

From a ticket, launch a `kind: "custom"` (bare) claude session that:

1. Opens in the **ticket's worktree if one exists**, else falls back to the ticket's mapped
   **repo root** (same resolution the lime path uses: `resolveWorktree(repo, ticket) ?? repo`).
2. Has the ticket's **`LIME_SESSION_CONTEXT`** written and passed via env, so the session is
   ticket-aware (a `/lime-next` typed later would pick it up) — but the launch command is
   **bare claude, never `/lime-next`**.

## Non-goals

- **Worktree creation.** If no worktree exists we fall back to the repo root; we do not cut a
  new worktree (that is lime Stage 1's job).
- SessionList card restyling beyond what the existing `title` / `ticket` fields already drive.
- Deduplication. Like all custom sessions, the id has a random suffix, so a ticket may have
  a lime session and one or more custom sessions concurrently.

## Design (Approach A — extend the existing custom path)

Reuse the single `launchCustomSession` code path rather than adding a parallel function.
A ticket-scoped custom launch differs from a project-scoped one only in: cwd resolution, the
context file, and the metadata carried onto the card. Everything else (settings write,
`newSession`, `pipePane`, meta upsert) is shared.

### 1. Server — `src/server/launch.ts`

**`CustomLaunchRequest`** gains optional ticket fields:

```ts
export interface CustomLaunchRequest {
  projectName: string | null;
  model: string;
  effort: Effort;
  // Ticket-scoped custom session (RIC-128). When `ticket` is set, cwd resolves through the
  // ticket→worktree chain and a launch-context file is written. Absent = project-scoped (RIC-115).
  ticket?: string;
  status?: string;
  title?: string;
  labels?: string[];
}
```

**`launchCustomSession`** branches on `req.ticket`:

- **cwd:**
  - `ticket` present → `const resolveCwd = deps.resolveCwd ?? defaultResolveCwd(deps.projectsPath); const cwd = resolveCwd(req.ticket, req.projectName)`. This is the *same* resolver `launchSession` uses, so it returns the ticket's worktree if one exists, else the mapped repo root; `null` → `{ ok: false, reason: "no-repo" }`. (`defaultResolveCwd` and the `deps.resolveCwd` injection point already exist — no new resolver code, and it stays stubbable in tests.)
  - `ticket` absent → unchanged: `resolvePathForProject(...)` or `homeDir()`.
- **id:** `ticket` present → `customSessionName(statusSlug(req.ticket), genId())` → e.g. `mojito-custom-ric-128-<hex>`. Absent → unchanged (`statusSlug(projectName)` or `"general"`).
- **context file:** `ticket` present → `const contextPath = writeLaunchContext(deps.stateDir, id, { identifier: req.ticket, statusName: req.status ?? "", title: req.title ?? "", project: req.projectName, labels: req.labels ?? [] })`. Absent → no context file (unchanged).
- **command:** `buildCustomClaudeCommand(req, settingsPath, contextPath)` — see below. Still bare claude, no `/lime-next`.
- **meta:** `ticket` present → `ticket: req.ticket`, `title: req.title ?? basename(cwd)`, `labels: req.labels ?? []`. Absent → unchanged (`ticket: ""`, `title` = `basename(cwd)`/`"home"`, `labels: []`). `launchStatus` stays `""` and `autoAdvance` stays `false` in both cases — a custom session never auto-advances.

**`buildCustomClaudeCommand`** gains an optional `contextPath`, mirroring `buildClaudeCommand`:

```ts
export function buildCustomClaudeCommand(req: CustomLaunchRequest, settingsPath: string, contextPath?: string): string {
  const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  const envPrefix = contextPath ? `LIME_SESSION_CONTEXT=${q(contextPath)} ` : "";
  return `${envPrefix}claude --model ${q(req.model)} --effort ${q(req.effort)} --settings ${q(settingsPath)}`;
}
```

### 2. API — `src/app/api/sessions/route.ts`

In the `body.kind === "custom"` branch, pass `ticket`, `status`, `title`, `labels`,
`projectName` through to `launchCustomSession`. Backward-compatible: the RIC-115
NewSessionSheet payload has no `ticket`, so it still launches a project-scoped custom session.
Return codes unchanged (422 `no-repo`, 201 on success).

### 3. UI — `src/components/LaunchSheet.tsx`

Add a **"Custom session"** button that POSTs:

```json
{ "kind": "custom", "ticket": "<identifier>", "status": "<statusName>",
  "projectName": "<project>", "title": "<title>", "labels": [...],
  "model": "<model>", "effort": "<effort>" }
```

- Reuses the sheet's existing `model` / `effort` state and the `onLaunched()` / `onClose()`
  flow (a new `startCustom()` helper alongside `start()`).
- **Available in every state of the sheet, including To QA.** The To QA branch currently
  renders only the approve/reject buttons; add the "Custom session" button there too. Since
  the model/effort selectors are not shown in the To QA branch, surface them (or a compact
  equivalent) alongside the button so the launch is configurable there as well. In the normal
  launch branch, the button sits next to the lime "Start session" button and reuses the
  selectors already on screen.
- No dedupe concerns: custom ids are random-suffixed, so no need to DELETE an existing session
  first (unlike the lime `start()`).

### 4. Tests — `tests/server/launch.test.ts`

Extend the existing `customDeps(over)` factory pattern with cases:

1. **Custom-from-ticket resolves the worktree** — stub `resolveCwd` to return a worktree path;
   assert `cwd` = worktree, `kind: "custom"`, `ticket` populated, `title`/`labels` carried,
   a context file is written at `context/<id>.json`, and the command string starts with
   `LIME_SESSION_CONTEXT='…' claude …` and contains no `/lime-next`.
2. **Falls back to repo root** — `resolveCwd` returns the repo root (no worktree); assert
   `cwd` = repo root and the session still launches.
3. **Unmapped ticket** — `resolveCwd` returns `null`; assert `{ ok: false, reason: "no-repo" }`.
4. **Project-scoped custom unchanged** — no `ticket`; assert no context file is written and
   behavior matches today (regression guard).

## Data flow

```
LaunchSheet "Custom session"
  → POST /api/sessions { kind:"custom", ticket, status, title, labels, projectName, model, effort }
    → launchCustomSession(req, deps)
        ticket set → cwd = resolveWorktree(repo, ticket) ?? repo   (no-repo if unmapped)
                     id  = mojito-custom-<ticket-slug>-<hex>
                     writeLaunchContext(...) → contextPath
                     command = LIME_SESSION_CONTEXT='…' claude --model … --effort … --settings …
                     newSession → pipePane → registry.upsert({ kind:"custom", ticket, title, … })
```

## Error handling

- Unmapped team/project → `no-repo` (422), surfaced in the sheet's error text, same as the
  lime path and today's project-scoped custom path.
- Missing worktree is **not** an error — it is the repo-root fallback.

## Success criteria

- From a ticket's LaunchSheet, "Custom session" launches a bare claude session whose cwd is the
  ticket's worktree when one exists, else the mapped repo root.
- The session's tmux command sets `LIME_SESSION_CONTEXT` to a written context file for that
  ticket and does **not** contain `/lime-next`.
- The button is present and functional in every sheet state, including To QA.
- Project-scoped custom sessions (RIC-115) are unaffected.
- `npx tsc --noEmit && npx vitest run` passes, including the new launch tests.
