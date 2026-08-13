# QA rework in the live session — Design

## Problem

QA reject throws away the session that did the work.

`resolveQaVerdict` (`src/server/qaVerdict.ts:32`) handles `reject` by calling `launchRework`,
which in `src/app/api/tickets/[id]/verdict/route.ts:71` kills the ticket's work session with
`supersedeSession`, then launches a fresh one carrying the typed reason in its context file,
then moves the ticket back to In Progress.

The replacement session starts cold. It has none of the conversation that produced the branch:
not the design discussion, not the rejected alternatives, not the reasons behind the choices it
is about to be asked to revise. It re-reads the code to rebuild what the previous session
already knew, and it can reopen decisions that were settled hours ago. The QA feedback loop —
the one place where continuity is worth the most — is the one place Mojito discards it.

The live session is right there. It sat idle in tmux from the moment it wrote its result file
until reject killed it.

## Goals

- QA rework happens in the session that did the work, with its context intact.
- The human types the feedback straight into that session. Mojito does not broker it.
- The board stops flapping In Progress ↔ To QA once per round.
- A ticket whose session is genuinely gone can still be picked back up.
- A branch already merged outside Mojito closes to Done in one tap, running no git at all.

## Non-goals

- No feedback channel of any kind: no reason field, no injected prompt, no feedback file.
  The QA conversation is a conversation, held in the session's own terminal.
- No change to the approve machinery. The server-side merge, the MR path, and the conflict
  session all stay as they are; the gate only decides when to offer them.
- Not fixing "approve while a rework round is in flight" (see Failure modes).
- No manual status control in Mojito. The result file keeps that job.

## Design

### 1. The lifecycle

- A work session finishes a round and writes `{"outcome": "ready-for-qa"}`. The Stop hook
  moves the ticket to To QA. The session stays alive — with reject gone, nothing kills it.
- The QA gate asks whether there is anything left to merge. If there is not — the branch is
  already in the default branch, or the work never took a branch of its own — the only action
  is `mark-done`: status to Done, no git. Otherwise the gate offers `approve-local` and
  `approve-mr` as today.
- Rework: the human opens the live session and types what is wrong. That round ends, the
  session writes the result file again, the hook re-fires the move — a no-op, the ticket is
  already at To QA. The ticket parks at To QA for as many rounds as it takes.
- Approve → server-side merge → Done, then `supersedeStaleSession` retires the finished work
  session. Unchanged.
- Approve whose merge cannot complete → conflict session → `{"outcome": "merged"}` → Done.
  Unchanged apart from the result-file trim.
- Session dead while the ticket sits at To QA → launch a work session from the sheet. It takes
  the id its predecessor had and leaves the board alone.

Accepted consequence: a ticket's Linear status no longer distinguishes "waiting for a human"
from "a session is reworking it". Both read as To QA. That signal now lives only in Mojito's
session state badge. Not flapping the board is worth more than encoding it in Linear.

### 2. Reject is removed

- `src/server/qaVerdict.ts` — `"reject"` out of `QaArg` and `QA_ARGS`; the reject branch, the
  `launchRework` dep, the `{done: "rework-session"}` variant, and the "rejection reason
  required" `QaVerdictError` all go.
- `src/app/api/tickets/[id]/verdict/route.ts` — delete the `launchRework` closure entirely
  (its two `supersedeSession` calls, its `prepareTicketAssets`, its `launchSession`), plus the
  `workSessionRelaunched` flag and the guard in `supersedeStaleSession` that exists only for
  it. `reason` drops out of the request body.
- `src/server/launch.ts` — `rejectReason` off `LaunchRequest` and out of the context spread.
- `src/server/launchContext.ts` — the `rejectReason` field and its comment.
- `src/components/QaVerdictButtons.tsx` — the reject button, the reason textarea, the
  `rejecting` state. `src/components/LaunchSheet.tsx` — `onReject` and `"reject"` out of the
  pending union. `src/lib/verdictOutcome.ts` — the `rework-session` case.
- `CLAUDE.md` — the `rejectReason` field in the context-file description (line 23) and the
  "reject launches the rework session with the reason in its context file" clause (line 32).

Nothing to migrate: `rejectReason` only ever existed inside a launched session's context file.

### 3. The result file shrinks to a status signal

```ts
export interface SessionResult {
  outcome: "ready-for-qa" | "merged";
}
```

`notes` and `"blocked"` go from the type, the parse, and the validity check in
`src/server/sessionResult.ts`. `notes` is already dead: `hookHandler.ts` never reads it, so no
alert copy changes. `"blocked"` never moved a status either — a blocked session now simply says
so in its terminal, where the human is already looking.

`"merged"` stays, written only by the conflict session, so an approved-but-conflicted merge
still closes itself out to Done without a human step.

### 4. The work prompt

`src/server/prompts/work.ts` keeps only what a session cannot infer: Mojito's two channels.
The design/plan/implement/review sequence goes, and so does the worktree instruction — both
are session-level decisions, the same as in a hand-started session. A one-line fix does not
need a branch of its own any more than it needs a brainstorming round. The Bug →
`systematic-debugging` routing goes too: the labels are in the context file, so the session
can make that call itself.

```
You are working Linear ticket {{TICKET}} end to end in this repository.

First read the JSON session context at {{CONTEXT_PATH}}: identifier, statusName,
title, project, labels, and description. Mojito already read all of that from Linear,
so you never have to spend tokens re-reading it.

{{ASSETS_PARAGRAPH}}Result file — REQUIRED. As the very last action of a round, write {{RESULT_PATH}}
with exactly this JSON object:
  {"outcome": "ready-for-qa"}
It is the only signal Mojito has to move {{TICKET}} to To QA. Your session stays
alive afterwards: when the human comes back with QA feedback, work it and write the
file again at the end of that round.
```

`{{ASSETS_PARAGRAPH}}` is conditional. `buildWorkPrompt` takes a new `hasAssets` flag and
interpolates the paragraph only when it is true, collapsing to nothing (no blank gap) when it
is false:

```
The context also carries `assets` (each `{url, localPath}`) and `attachments`
(each `{title, url, localPath?}`) — Mojito already downloaded those files for you
because their URLs sit behind Linear's file auth. Before you start, open every
`localPath` you can with the Read tool. A `localPath` ending in `.bin` is a content
type Mojito could not identify; treat it only as a file you know exists, not one you
can Read. An attachment with no `localPath` is a plain link, informational only.
```

Most tickets carry no attachments at all, and today every one of them pays for six lines
explaining files it does not have — lines that also invite a session to go looking for keys
that are not in its context file. `launchSession` already holds the answer: it passes
`hasAssets: Boolean(req.assets?.length || req.attachments?.length)`, the same condition that
decides whether the keys land in the context file. The paragraph now says "also carries"
rather than "may also carry", because it only appears when they are there.

Dropping the worktree instruction has one downstream consequence, handled in section 6: a
ticket worked directly in the project checkout has no branch for approve to merge. Rather than
letting that ticket dead-end at the gate with `no worktree for ticket`, "nothing to merge" and
"already merged" collapse into the same answer, and both offer Mark Done.

The Linear silence established by RIC-184 is untouched: the prompt still says nothing about
whether the session may use Linear, and `tests/server/prompts.test.ts` still fails on either
polarity creeping back.

`src/server/prompts/conflict.ts` drops `notes` and the `blocked` variant, leaving
`{"outcome": "merged"}`.

### 5. Relaunching at To QA

`src/server/sessionKey.ts` — `To QA` joins the work states in the `work` slug, so
`tmuxName(t, "To QA")` returns `mojito-<t>-work`. A QA-time relaunch then takes exactly the id
its predecessor had, which is what keeps the duplicate guard and the "open running session"
lookup pointed at one session per ticket. The comment above `tmuxName` gains that second
reason.

No server-side status change is needed: `src/app/api/sessions/route.ts:82` moves only
`Backlog`/`Todo` to In Progress, so a To QA launch leaves the board alone for free.

`src/components/LaunchSheet.tsx`, To QA branch — today it renders the verdict buttons and the
bare Claude/Terminal buttons, and offers no way to open the ticket's live work session, which
is now the primary QA action. It offers "Open session" whenever a `-work` session is registered
(its scrollback is worth reading dead or alive) and a work launch button whenever that session
is not alive — both at once for a registered-but-dead session, since registry entries are never
dropped automatically and `start()` clears one before relaunching. That choice goes into a pure
`qaSessionModel` helper in `src/lib`, alongside `qaGateModel`.
To QA stays out of `LAUNCHABLE_STATUSES`, so that launch borrows the In Progress model/effort
defaults rather than adding a stage-defaults row and its sync test.

### 6. "Nothing to merge" detection and `mark-done`

Two situations reach To QA with no merge left for Mojito to run. You merged the branch
yourself — a GitHub PR, a squash from the web UI, a local merge — or the session never took a
branch at all, which the prompt now permits for small work. In the first case approve's paths
that still *fail* are exactly the ones a live session at To QA makes likely: the session left
the worktree dirty (`status --porcelain` non-empty → `{status:"error"}`), or the repo root is
parked on another branch, and both spawn a conflict session to fix a merge that already
happened. In the second, approve cannot even start: `resolveDirs` finds no worktree and the
verdict throws `no worktree for ticket`.

Both collapse to the same question — *is there anything left to merge?* — and to the same
answer when there is not: write Done.

**Detection.** New `isAlreadyMerged({worktree, repoRoot}, run)` in `src/server/merge.ts`,
sharing that module's `GitRun` seam and default runner:

1. `rev-parse --abbrev-ref HEAD` in the worktree; a detached HEAD answers `false`.
2. `fetch --prune` when a remote exists, then `target = origin/<def>` (else `<def>`), reusing
   `detectDefaultBranch`. The fetch is not optional: a manual merge usually happened on the
   remote, so a stale `origin/<def>` would answer `false` precisely when the answer matters.
3. `merge-base --is-ancestor <branch> <target>` → exit 0 means merged. This catches a real
   merge or a rebase-merge.
4. Otherwise `cherry <target> <branch>`: no `+` lines means every commit on the branch already
   has an equivalent upstream, which is how a squash-merge looks. Also merged.
5. Any git failure answers `false`. A broken check must degrade into today's behavior, never
   block the gate.

It reads history only — no fetch side effects beyond updating remote refs, no rebase, no
checkout — so it is safe to run on sheet open.

**The question, in one place.** New `hasNothingToMerge(projectsPath, ticket, projectName)` in
`src/server/ticketMergeState.ts`. Both the endpoint and the verdict call it, so the gate and
the guard can never disagree. It needs the worktree/repo-root resolution the verdict route
holds inline today, so that block moves to a shared `src/server/ticketDirs.ts`.

It never answers `true` without asking git about a branch — a wrong `true` hides the approves
and writes Done over unmerged commits:

1. Main checkout unresolvable → `false`. "I could not tell" is not "there is nothing to merge";
   the ordinary approve path runs and fails loudly if it must.
2. Otherwise the checkout to inspect is the ticket's worktree, or the repo root when it has
   none.
3. That checkout's HEAD is the default branch → `true` (new `isOnDefaultBranch` in
   `src/server/merge.ts`). This is the real "no branch of its own" case. It does not go through
   `isAlreadyMerged`: a local default branch ahead of its remote fails the ancestry check and
   would strand the ticket at a gate that can never clear.
4. Otherwise defer to `isAlreadyMerged({worktree: thatCheckout, repoRoot})`.

There is deliberately no `worktree === repoRoot → true` short-circuit. `matchWorktree` matches
any worktree whose branch carries the ticket id, the main one included, so a session that ran
`git checkout -b ric-190-fix` in the repo root and committed there hits that case with real
unmerged work. Such a ticket now answers `false`, the gate offers the approves, and
`approve-local` throws `cannot resolve the main checkout for the ticket worktree` (400) — an
honest error to act on instead of a silent Done over unmerged commits.

**Endpoint.** `GET /api/tickets/[id]/merge-state?projectName=<name>` →
`{ nothingToMerge: boolean }`. Named for what it answers: "merged" would be a lie for a ticket
that never had a branch.

**Verdict.** `"mark-done"` joins `QA_ARGS`. In `resolveQaVerdict` it re-runs the check
server-side and, if there *is* something to merge, throws
`QaVerdictError("branch has unmerged commits")` → 400. Otherwise it writes Done and returns
`{done: "marked-done"}`. The re-check closes the window between the sheet rendering and the
click, and costs one `fetch` on a path that would otherwise do far more work.
`supersedeStaleSession` then retires the work session, as it does after any successful
verdict — the ticket is finished either way.

**UI.** `LaunchSheet`'s To QA branch fetches the merge state when it opens and renders one of
three states: checking (a disabled row, so no verdict is submitted against an unknown state),
nothing-to-merge (a single "Mark Done" button — the two approves are hidden, since re-merging a
merged branch is a no-op at best and a missing branch has nothing to merge), mergeable
(`approve-local` / `approve-mr`, as today). The choice of state goes into a pure `qaGateModel`
helper in `src/lib`, following `terminalHeadModel` and `holdsSheetOpen`. `holdsSheetOpen` answers `false` for `marked-done`: there is no URL or
diagnostic to keep on screen.

## Failure modes

- **Linear write fails on the To QA move.** Unchanged: `hookHandler` leaves the result file in
  place and `mapHook` returns `needs-input`, so the next Stop retries. `clearResult` runs only
  on success, so no round double-fires the move.
- **The second round's result must not be swallowed.** The loop depends on one ordering
  detail: the session's own `Write` of the result file fires `PostToolUse`, which pulls the
  session out of `done` → `running`, *before* `Stop` arrives. So the `meta.state !== "done"`
  guard in `src/server/hookHandler.ts:67` never blocks a later round. Without that ordering the
  board would silently stop moving after round one, which is why it gets a regression test.
- **Approve while a rework round is in flight.** The merge runs against a dirty worktree,
  `mergeTicketBranch` returns `error`, and a conflict session is launched to finish the job.
  Pre-existing behavior, but more reachable now that a live session at To QA is the normal
  state rather than the exception. Out of scope here; named so it is not a surprise.

## Tests

Deletions: the reject cases in `tests/server/qaVerdict.test.ts`, `verdictRoute.test.ts` and
`ticketVerdict.test.ts`; the `rejectReason` cases in `launchContext.test.ts` and
`launch.test.ts`; the `rework-session` row in `tests/lib/verdictOutcome.test.ts`.

Additions:

- `QA_ARGS` is exactly `approve-local`, `approve-mr`, `mark-done`, and a `reject` request body
  gets 400 `invalid arg`. Reject dying is a behavior, so it is asserted rather than merely
  absent.
- `isAlreadyMerged`, against a scripted `GitRun`: true when `--is-ancestor` exits 0; true when
  it fails but `cherry` prints no `+` line (the squash-merge case); false when `cherry` prints
  one; false on a detached HEAD; false when any git call throws.
- `isOnDefaultBranch`, against the same scripted `GitRun`: true when HEAD is the default
  branch; false on a ticket branch, on a detached HEAD, and on any git failure.
- `hasNothingToMerge`: false when the main checkout cannot be resolved; true when the inspected
  checkout (worktree, else repo root) is on the default branch; false when it is on a ticket
  branch — including `worktree === repoRoot`, the case that used to short-circuit to true; and
  otherwise whatever `isAlreadyMerged` answers.
- `mark-done` writes Done and touches no git; `mark-done` with commits still to merge throws
  `QaVerdictError` and leaves the status alone.
- `qaGateModel`: checking → no verdict buttons; nothing-to-merge → `mark-done` only, no
  approves; mergeable → both approves, no `mark-done`.
- `readSessionResult` returns `null` for `blocked` and drops `notes` when a file carries it.
- `tmuxName(t, "To QA")` === `mojito-<t>-work`, next to the existing work-state case.
- `hookHandler`: a Stop → PostToolUse → Stop sequence fires `moveToQa` twice. This is the
  rework-loop guard.
- `prompts`: the work prompt contains no `blocked`, no `notes`, no `rejectReason`, and no
  worktree instruction.
- `prompts`: with `hasAssets: false` the prompt contains no `localPath` and no `attachments`,
  and leaves no blank gap where the paragraph would be; with `hasAssets: true` it contains
  both. The existing "tells the work session to read the assets Mojito downloaded" case
  becomes the true half of that pair.
- The To QA sheet decision (open vs. launch) goes into a pure helper in `src/lib` — the
  pattern `terminalHeadModel` and `holdsSheetOpen` already follow, since `tests/client` covers
  pure logic and has no render harness — with a unit test there.

Gate: `npx tsc --noEmit && npx vitest run`.
