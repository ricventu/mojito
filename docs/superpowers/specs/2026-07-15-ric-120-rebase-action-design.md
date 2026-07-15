# RIC-120 — To-QA rebase action

**Status:** design
**Date:** 2026-07-15
**Ticket:** RIC-120 "action per fare rebase"

## Problem

While a ticket waits in **To QA** for a human, the default branch can advance as other
tickets merge. When that happens the branch under QA is tested against stale code and the
eventual To Merge is no longer a clean fast-forward. We want a one-click action, shown for a
ticket in **To QA with no active session**, that rebases the ticket's worktree branch onto
the current default branch and — if the rebase changed code — runs a code review before the
human QAs it. In the ticket author's words, it should "behave like the first part of the To
Merge stage".

## Decisions (brainstormed)

1. **Where the rebase logic lives — a new lime command.** The rebase+review logic is lime
   lifecycle logic, and CLAUDE.md mandates a one-directional dependency (Mojito depends on
   lime; cross-cutting changes go into lime first). So we add a standalone
   `/lime-rebase <ID>` command in the lime repo. It has bare-terminal value on its own, and
   Mojito just launches it — no rebase logic embedded in a Mojito string.

2. **How far it goes — full Stage-5 first-part parity.** After the rebase, if the tree
   changed, run `superpowers:requesting-code-review`; on blocking findings do up to **2**
   inline fix→review cycles. Fixed or clean → stay at **To QA** (a human still QAs). Still
   blocking / needs real rework → set **To Code**. The only status change is that escalation;
   every other path leaves the ticket at To QA. It never merges (the ticket is not at To
   Merge).

3. **The Stage 5 overlap — keep `/lime-rebase` self-contained for now.** `/lime-rebase` owns
   its own copy of the rebase+review+fix logic; Stage 5 (To Merge) is left untouched with a
   cross-reference note. A follow-up ticket will unify the shared block so Stage 5 delegates
   to it. This keeps RIC-120 scoped and avoids destabilizing the merge flow.

## lime side — `/lime-rebase <ID>`

New skill `skills/lime-rebase/SKILL.md`, registered in `.claude-plugin/plugin.json` (version
bump) with a README row. Prerequisites mirror lime-next: Linear MCP for the status write,
`superpowers:requesting-code-review` available.

Steps:

1. **Resolve ticket + repo + worktree.** Reuse lime-next's Step 1 / Step 1.5 logic: read the
   launch context (`LIME_SESSION_CONTEXT`) when its `identifier` matches (skip `get_issue`),
   else `get_issue`; resolve the repo from `~/.claude/lime-projects.json` (fall back to the
   current repo); find the ticket's worktree via `git worktree list --porcelain`, `cd` into
   it, and **verify** `git rev-parse --show-toplevel` is the worktree and
   `git branch --show-current` is the ticket branch (never the default). Refuse otherwise.
   Print the `/rename` line at launch (work-status `[To QA]`).
2. **Status guard.** If the ticket is not at **To QA**, stop and report — `/lime-rebase` is a
   To-QA-only action.
3. **Rebase onto the default branch** (mirrors Stage 5 steps 2–3):
   - Fetch is **best-effort**: if a remote for the default branch exists, `git fetch` it; if
     there is no remote (this repo is local-only — `git remote -v` is empty), skip the fetch
     and rebase onto the local default branch. *(Stage 5 fetches unconditionally; `/lime-rebase`
     tolerates a remote-less repo — noted for the future unification.)*
   - `PRE=$(git rev-parse HEAD^{tree})`, `git rebase <default>`, `POST=$(git rev-parse HEAD^{tree})`.
   - **Conflict** → `git rebase --abort`, post a comment noting the conflict must be resolved
     manually, **stay To QA**, stop.
4. **Review only if content changed.**
   - `PRE == POST` (no change) → post a comment "branch already current; nothing to rebase",
     **stay To QA**.
   - `PRE != POST` → `superpowers:requesting-code-review` on `<default>..HEAD`:
     - **clean** → post a comment (rebased, review clean), **stay To QA**.
     - **blocking** → up to **2** inline fix→review cycles (apply targeted fixes, commit,
       re-review):
       - re-review **clean** (fixes applied) → post a comment listing findings + fixes, **stay
         To QA** (a human re-QAs the new code).
       - still blocking after 2 cycles / needs real rework → post findings, set **To Code**.
5. **Linear comment.** Exactly one comment recording the outcome, command-agnostic wording
   (never mention lime / slash commands — per lime's Linear-sync rule).

Status writes resolve the target state via `list_issue_statuses` + `save_issue`, same as
lime-next. `/lime-rebase` never auto-chains into another stage.

## Mojito side — launch a rebase session

- **`src/server/sessionKey.ts`** — add `rebaseSessionName(ticket)` → `mojito-<ticket>-rebase`.
  Distinct from the `-to-qa` gate session name so the two never collide.
- **`src/server/types.ts`** — extend `SessionMeta.kind` to `"lime" | "custom" | "rebase"`.
  A rebase session is ticket-bound but is **not** a lifecycle stage, so it must not carry the
  auto-advance affordances a `"lime"` session does.
- **`src/server/launch.ts`** — `launchRebaseSession({ ticket, projectName, title, labels,
  model, effort }, deps)`:
  - session id = `rebaseSessionName(ticket)`; duplicate check like `launchSession`.
  - resolve cwd via the same `defaultResolveCwd` (lands in the ticket's worktree).
  - write hook settings + launch context (`statusName: "To QA"`) so `/lime-rebase` can skip
    `get_issue`.
  - command = `buildRebaseClaudeCommand(req, settingsPath, contextPath)` →
    `LIME_SESSION_CONTEXT=… claude --model … --effort … --settings … '/lime-rebase <ID>'`.
  - `SessionMeta`: `kind: "rebase"`, `ticket`, `launchStatus: "To QA"`, `autoAdvance: false`,
    `state: "starting"`. Defaults: model `opus`, effort `xhigh` (analytical, like To Merge).
- **`src/app/api/sessions/route.ts`** — new `if (body.kind === "rebase")` branch (parallel to
  the `custom` branch) calling `launchRebaseSession`. Validates `ticket`; ignores/omits
  `trailingArg`.

## UI — `src/components/LaunchSheet.tsx`

In the `isToQa` branch, alongside `QaVerdictButtons`, render a **Rebase** button gated on
**no active session for the ticket**:

```
const noActiveSession = activeSessionLevel(ticket.identifier, sessions) === null;
…
{isToQa && (
  <>
    <QaVerdictButtons … />
    {noActiveSession && <button className="btn ghost block" onClick={startRebase}>Rebase onto default branch</button>}
  </>
)}
```

- `activeSessionLevel` (from `src/lib/ticketSessionLevel.ts`) is the same signal as the ticket
  dot — a launched rebase session (`starting`/`running`) hides the button; a finished one
  (`done`) is ignored so the button returns.
- `startRebase` clears any stale `mojito-<id>-rebase` session (DELETE by id, like `start`
  does), then POSTs `{ kind: "rebase", ticket, model, effort }` to `/api/sessions`, and on
  success opens the session / closes the sheet.
- Verdict buttons stay unconditional (a human can still approve/reject while a rebase runs).
- **`src/components/SessionList.tsx`** — render a `kind: "rebase"` session like a lime card
  but with a `rebase` chip and **no** auto-advance toggle (the toggle is lime-stage only).

No extra confirmation dialog: the action only touches the ticket's own branch and aborts
cleanly on conflict; launching a session is already a deliberate act.

## Tests (`tests/server/`, `tests/lib/`)

- `sessionKey` — `rebaseSessionName` shape + ticket validation.
- `launch` — `launchRebaseSession`: command string runs `/lime-rebase <ID>`, writes the launch
  context with `statusName: "To QA"`, uses the rebase session name, `autoAdvance: false`,
  duplicate rejection.
- sessions route — `kind: "rebase"` branch: happy path (201), missing/invalid ticket (400/422),
  duplicate (409).
- `ticketSessionLevel` already tested; add a client-side test that the To-QA gate shows the
  rebase button only when `activeSessionLevel` is null.

## Cross-repo procedure (per CLAUDE.md)

1. lime repo, own branch: add `skills/lime-rebase/SKILL.md`, README row, bump
   `.claude-plugin/plugin.json`, add the Stage-5 cross-reference note.
2. **Rebuild the plugin cache** via `/plugin` so `~/.claude/plugins/cache/lime/lime/<version>/`
   has the new command (editing source alone has no runtime effect).
3. Adapt Mojito (above) with tests.
4. No Linear workflow-state changes (still To QA).

## Out of scope / follow-up

- Unifying Stage 5's first part with `/lime-rebase` (shared block, Stage 5 delegates) — a
  separate ticket.
- Exposing model/effort selectors for the rebase button (fixed opus/xhigh for now).
- Rebase actions in statuses other than To QA.
