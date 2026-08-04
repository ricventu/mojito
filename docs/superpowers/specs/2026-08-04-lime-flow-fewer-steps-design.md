# Fewer steps in the lime flow — design

2026-08-04

Cross-repo: parts 1, 3 and 4 change [lime](https://github.com/ricventu/lime); parts 2 and 5
change Mojito. Per `CLAUDE.md`, lime ships first and Mojito adapts to it.

## Problem

Work that should go through the lifecycle is being done outside it. Across the last 40
merges of `mojito`, `GestionaleCooperativeMvp` and `factorybook` (66 merge commits),
branches whose name carries no Linear identifier — i.e. never touched by lime, which always
names branches from Linear:

| lines changed | branches | with a ticket | without |
|---|---|---|---|
| < 150 | 20 | 2 | **18** |
| 150–400 | 18 | 13 | 5 |
| ≥ 400 | 28 | 20 | 8 |

The stated reason is not the size of the work: **the flow with all its steps is heavy.**
`ricventu/italian-localization-and-static-analysis` (2953 lines),
`chore/queueable-actions-architecture` (3157) and `redesign/warm-editorial-ui` (1850) all
skipped the pipeline too.

Measured cost of that flow today, per normal ticket in Mojito: **3 sessions and ~7
interactions** — launch the design session, run its printed `/rename`, answer the
brainstorm, the auto-advance opens implementation, run its `/rename`, the run parks at To
QA, press Approve, *come back and launch the merge yourself*, run its `/rename`, answer
`local`/`mr`. (Stage 3 is no longer in the count: since lime 0.20.0 the reviewed-tree
marker takes `lime-implement` straight to To QA.)

Two latent defects surfaced while measuring:

1. **The approve leads nowhere.** `resolveQaVerdict` (`src/server/qaVerdict.ts:22`) writes
   Linear and returns; auto-advance only ever fires from a live session's Stop hook
   (`src/server/hookHandler.ts:85`), and the in-app verdict bypasses sessions by design. So
   To Merge is never picked up and the user makes a return trip.
2. **A QA rejection never reaches the implementation.** No lime skill reads Linear comments
   (only `save_comment` appears in all eight SKILL.md files). The rejection reason is
   written as a comment nobody reads, and the ticket lands at To Code where
   `lime-implement` re-reads a plan whose checkboxes are all ticked: it executes nothing,
   writes no marker, and exits toward review/QA with the findings untouched. It only
   appears to work because the operator, sitting in the session, says what to fix by hand —
   itself one of the manual steps under complaint.

Supporting token measurements (from `~/.claude/projects/*/*.jsonl` `usage` fields, input
equivalent weighting cache reads 0.1× and writes 1.25×): the initial cached prefix of a
session is 14.2k–19.1k tokens and remarkably constant; the cheapest *complete* stage
sessions still cost 150k–330k for 12–32 turns; design sessions run 111–239 turns and
2.1M–5.1M; implementation 123–216 turns and 2.5M–4.6M. Session count is therefore a real
cost, but the per-session floor is small next to the body of a stage — which is why this
design removes **steps and return trips** first and collapses stages only where the plan
boundary does not pay.

## Requirements

1. Fewer steps for **every** ticket, not only small ones.
2. The To QA gate stays the single human checkpoint.
3. No new questions asked of the operator. Removing a question is progress; replacing it
   with a setting to maintain is not.
4. lime keeps working standalone in a bare terminal, and keeps its **one stage per
   invocation** invariant. Chaining is the orchestrator's job, and the orchestrator is
   Mojito.
5. A rejected ticket must come back with its findings as *work*, not as prose in a comment.

Target shape: launch one session (design or express) → answer the brainstorm only when it
is a design → the run parks at To QA → press "Approve & merge" → the merge session starts
itself with the mode already chosen → Done. **2–3 sessions, 2 interactions.**

## Design

### Part 1 — lime: no `/rename` print under an orchestrator

Every stage skill prints a `/rename` command for the user to run before doing any stage
work: `lime-design:36`, `lime-implement:31`, `lime-review:30`, `lime-qa:30`,
`lime-merge:31`, `lime-rebase:31`. Six sites.

Each becomes conditional: **print it only when `LIME_SESSION_CONTEXT` is unset.** A bare
terminal keeps today's behaviour; a Mojito-launched session prints nothing.

This is safe because under Mojito the rename is cosmetic. The tmux session name comes from
`tmuxName()` (`src/server/sessionKey.ts`), the session card shows the Linear title passed
at launch, and `handleHook` updates a session's title from the transcript only for the
`custom`, `rebase` and `shell` kinds — never for `lime` (`src/server/hookHandler.ts:26-57`).
The four prints per ticket are four manual commands that change a string inside the Claude
Code TUI and nothing else.

`lime-next:108` mentions "the `/rename` print" when describing what a stage skill owns;
update that sentence so the dispatcher's prose does not contradict the stage skills.

### Part 2 — Mojito: the verdict launches the next session

`resolveQaVerdict` keeps its Linear writes and gains no knowledge of sessions. The launch
belongs to the route (`src/app/api/tickets/[id]/verdict/route.ts`), which already owns the
registry and config, and it reuses the machinery auto-advance uses —
`buildAutoAdvanceRequest` + `launchSession` (`src/server/autoAdvanceRunner.ts`) — so the
next stage runs at its own per-status default model and effort.

The QA arg widens from `"approve" | "reject"` to carry a merge mode:

```ts
export type QaArg = "approve" | "approve-local" | "approve-mr" | "reject";
```

- `approve-local` / `approve-mr` → set To Merge, then launch the To Merge session with
  `trailingArg` set to `local` / `mr`. Both already exist end-to-end:
  `LaunchRequest.trailingArg` (`src/server/launch.ts:27`) is appended by
  `buildClaudeCommand` (`launch.ts:56`), and `lime-merge` step 3 uses the trailing arg when
  given "otherwise ask". Passing it removes the `local`/`mr` question without touching lime.
- `approve` → set To Merge and launch nothing, exactly as today. Kept so an approval is
  never coupled to an integration decision the operator did not make.

  All three approve variants write the same status; only the launch differs. Keep that
  mapping in `resolveQaVerdict` so the Linear side stays one branch.
- `reject` → comment, set To Code, **then launch the To Code session**. Symmetric with
  approve, and it works only because part 3 lands first: the launched session reads the
  findings. `resolveQaVerdict` already posts the comment *before* the status write, so the
  comment is on record before the session starts. This removes the second return trip.

The gate UI gains the buttons: `Approve & merge`, `Approve & MR`, `Approve`, `Reject`.

`resolveTicketVerdict` (`src/server/ticketVerdict.ts`) keeps validating the arg and the live
status and keeps `supersedeStaleSession` — the stale gate session must be retired **before**
the new one is launched, or two sessions briefly claim the ticket.

Nothing in the state machine changes. A launch at To Merge that ends at Done gives
`stageAdvanced("To Merge", "Done")` → true and `decideAutoAdvance("Done")` → stop, because
Done is in `TERMINAL_STATES`.

### Part 3 — lime: a hand-back becomes plan tasks

`lime-implement` gains a step in its Entry, after the status guard: read the ticket's recent
comments (Linear `list_comments`) and take the **newest hand-back comment** in that list —
one whose first line begins with `QA rejected — ` or `Merge review findings — `. Newest
matching comment only; earlier ones were either already addressed (their ids are in the
plan) or superseded. If one exists and its
comment id is not already recorded in the plan file, append its findings to the plan as a
new section of **unchecked** tasks, headed with the comment id, and commit it:

```markdown
## Findings from QA rejection (comment 8f2a…)

- [ ] <finding>
```

Idempotency lives in the plan file itself — no new marker file. A second run greps the plan
for the id, finds it, and adds nothing.

When no plan exists (an express ticket, part 4), the findings **are** the plan: create
`docs/superpowers/plans/<ticket>-<slug>.md` holding that section and commit it.

The existing "No plan found → STOP" guard is preserved, not weakened: it now fires only
when there is neither a plan nor a hand-back comment, which is exactly the case it protects
against — a stage launched in the wrong state by mistake.

This one change replaces the three that would otherwise be needed on the producing side
(`lime-qa` reject, `lime-merge` real-rework exit at line 105, `lime-rebase` escalation), and
it fixes the hole for normal tickets too, not just express ones. It also works on both
paths: Mojito's in-app reject never runs `lime-qa`, so a fix living in `lime-qa` would cover
only the bare terminal.

**Contract consequence.** The hand-back prefixes are now shared between the repos. Mojito
writes exactly `QA rejected — <reason>` (`qaVerdict.ts:28`); `lime-qa`'s reject leaves the
wording unspecified today, and `lime-merge` / `lime-rebase` post their findings with no
fixed opening. All must adopt the two prefixes above. They stay command-agnostic — they name
no skill, no slash command and no tool — so lime's comment-wording rule holds.

### Part 4 — lime: the `lime-express` stage skill

A new `skills/lime-express/SKILL.md`, taking `Backlog`/`Todo` → **To QA** in one session.
A separate skill rather than a mode on `lime-design`, because Mojito invokes stage skills
directly precisely so a session loads only the prose of the stage it runs: a flag on
`lime-design` would load the brainstorming branch for every 20-line fix, and would give one
skill two exit statuses and a bimodal description.

Entry mirrors `lime-design` (explicit TICKET-ID required, launch-context read, status guard
on Backlog/Todo, position guard on the ticket's repo main checkout) and, per part 1, prints
no rename under an orchestrator.

Body:

1. Update the local default branch and create the worktree exactly as `lime-design` does,
   including the branch-name verification — Linear's branch linkage and every later stage's
   branch guard depend on the exact name. The worktree is kept: dropping it would force
   changes to the position guards in `lime-qa` and `lime-merge` plus `resolveTicketCwd` in
   Mojito, for no saving.
2. **Mini-analysis** from the ticket title, description and labels. No `brainstorming`, no
   `writing-plans`, no spec or plan document: for a change this size the record is the
   commit message and the Linear comment.
3. **The escalation gate — evaluated once, before touching code.** Escalate if any holds:
   a design decision is open (more than one reasonable shape); more than ~150 changed lines
   are expected (`SMALL_DIFF_LINES`, `src/lib/reviewScale.ts`); more than three files; a
   migration or a change to the cross-repo contract is involved. To escalate, invoke
   `superpowers:brainstorming` then `superpowers:writing-plans` **in this session** — the
   context is already loaded — and exit at **To Code**. Mojito's auto-advance then launches
   `/lime-implement`, which finds the committed plan; a mis-triage costs one session boot.

   **This step depends on RIC-139 landing first.** Escalation fires exactly when a design
   decision is open, which is the case RIC-139 exists to fix: today a stage-1 brainstorm in
   auto mode answers its own open questions, commits, and advances the status. Shipping this
   escalation before that gate would add a path whose entire purpose is "a decision is open
   here" and have it decide anyway — worse here than in the design stage, since the express
   route has no plan document and no separate review stage. This step's stopping behaviour
   is whatever RIC-139 defines; it must not restate it.
4. **Test-driven implementation.** `superpowers:test-driven-development`: failing test, fix,
   passing test, then the full suite green. A purely visual or copy change is exempt from
   the new test but must still leave the suite green.
5. **Review.** `superpowers:requesting-code-review` on the branch diff, with the absolute
   worktree path in the dispatch prompt and the requirement to `cd` there — a dispatched
   subagent does not inherit the session's `cd`. Blocking findings are fixed inline and
   re-reviewed; if they demand a plan change, escalate as in step 3.
6. **Do not write the reviewed-tree marker.** Deliberate: the cost is one extra review at
   merge time, and only when the rebase actually changed the tree — already effort-scaled
   for small branches by `scaleReviewProfile`. The benefit is that no express ticket reaches
   the default branch on the strength of a review scoped by the same session that wrote the
   code.
7. Linear sync as the other stages do it: status → **To QA**, one command-agnostic comment
   (what changed, branch, commit range, and that this was a single-session route with no
   separate plan document), then the closing next-step line.

`lime-next` gains a dispatch row: Backlog/Todo with the `Express` label → `lime-express`.
Both repos match the label case-insensitively, as lime already does for `Bug`
(`lime-design:76`).

### Part 5 — Mojito: the express signal and launch path

The signal is the Linear label **`Express`** (capitalised, matching the existing `Feature` /
`Bug` / `Improvement` set), which sets the *default*; a toggle in the launch sheet is the
per-launch override.

- `src/lib/express.ts` — new, shared by UI and server so the pre-checked toggle and the
  server-side fallback cannot drift (the pattern `reviewScale.ts` and `stageDefaults.ts`
  already use): `EXPRESS_LABEL = "Express"` and
  `isExpressLabeled(labels: string[]): boolean`, case-insensitive.
- `slashForStatus(status, opts?: { express?: boolean })` — returns `/lime-express` when the
  status maps to stage 1 and `express` is set; unchanged otherwise. Express is ignored for
  every other stage: a ticket past design has no express route.
- `LaunchRequest.express?: boolean`. `launchSession` normalises it once —
  `req.express ?? isExpressLabeled(req.labels)` — then passes the resolved value to
  `buildClaudeCommand` and records it on `SessionMeta` so the card can badge the session
  (the provenance precedent is `scaledFrom`). `buildAutoAdvanceRequest` needs no change:
  auto-advance never launches stage 1.
- `LaunchSheet` — a toggle next to model and effort, shown only when the ticket's status is
  Backlog or Todo, pre-checked from `isExpressLabeled(ticket.labels)`.
- **Profile.** `stageDefaults` is keyed by status and express runs at Backlog/Todo, whose
  default is `opus`/`xhigh` — wrong for a 20-line fix. Add an `Express` entry
  (`opus`/`medium`) to `BUILTIN_STAGE_DEFAULTS`, to `LAUNCHABLE_STATUSES` (it gates
  `validateStageDefaults`, `sanitizeOverrides` and `mergeEffective`, so an entry absent from
  it can never be stored or overridden) and as a row in `STAGE_DEFAULT_ROWS`. All three
  together, or `tests/lib/stageDefaults.test.ts:10` and `:49` fail. Update the
  `LAUNCHABLE_STATUSES` doc comment: it will no longer hold only lifecycle statuses, and a
  list whose name lies is the drift this codebase avoids. `Express` must **not** enter
  `STAGE_OF`: it is a launch profile, not a workflow status, and `KNOWN_STATUSES` feeds the
  `tests/lib/status.test.ts` guard.

No change is needed in the state machine, which already permits the route:
`stageAdvanced("Backlog", "To QA")` is true (4 > 1 — the same multi-stage-jump invariant
`66ca24f` pinned for `To Code → To QA`), and `decideAutoAdvance("To QA")` returns `gate`, so
the express run parks at the human checkpoint instead of launching anything.

### Contract changes

`CLAUDE.md`'s shared-contract section lists three items today; it gains a fourth and amends
another:

- **New — hand-back comment prefixes.** `QA rejected — ` and `Merge review findings — ` are
  read by `lime-implement` and written by Mojito (`qaVerdict.ts`) and by lime's
  `lime-qa` / `lime-merge` / `lime-rebase`. Changing the wording on either side silently
  breaks rejection handling.
- **Amended — launch command per status.** `slashForStatus` now also maps stage 1 + the
  `Express` label to `/lime-express`, which raises the hard floor for that mapping to
  **lime ≥ 0.22.0** in the plugin cache.

## Rollout order

0. **lime — RIC-139 first, on its own version.** Every part of this design makes the flow
   more autonomous: the approve launches the merge, the reject launches implementation, the
   express route skips the plan boundary. Each removed step is one fewer moment where a
   human looks, so a stage 1 that answers its own open questions has to be fixed before, not
   after. Shipped as `0.21.0` and confirmed in the cache before anything below starts —
   separately, so that if the express work stalls, RIC-139 is already live.
1. **lime** — parts 1, 3, 4. Bump `.claude-plugin/plugin.json` to `0.22.0`, update the
   dispatch table and matrix in `skills/lime-next/SKILL.md` and `README.md`, then
   `/plugin` update and confirm `ls ~/.claude/plugins/cache/lime/lime/` shows 0.22.0. lime
   runs from the cache, not from source.
2. **Linear** — create the `Express` label once (workspace level, like the existing three).
3. **Mojito** — part 2, then part 5, then the UI. Part 5 must not ship before step 1 is in
   the cache: against an older cache `/lime-express` is an unknown slash command and the
   session stalls.
4. **`CLAUDE.md`** — the contract changes above.

Parts 1, 2 and 3 are independent of each other and of the express work; part 5 depends on
parts 1 and 4 being in the cache, and part 2's `reject` launch depends on part 3.

This is too much for one implementation plan. It decomposes into three, in this order, all
of them behind RIC-139: **(a) lime** — parts 1, 3, 4 plus the version bump and cache
rebuild; **(b) Mojito verdict** — part 2 and its tests; **(c) Mojito express** — part 5, the
UI and the contract edits. Each is independently shippable and leaves the flow working.

## Testing

lime has no test suite; its changes are verified by running a ticket through each path.

Mojito (`npx tsc --noEmit && npx vitest run`):

- `tests/server/stageCommand.test.ts` — stage 1 with `express` → `/lime-express`; stage 1
  without → `/lime-design`; `express` on a later stage ignored; unknown status →
  `/lime-next`.
- New `tests/lib/express.test.ts` — `isExpressLabeled` with the label present, absent, in
  mixed case, and among other labels.
- `tests/server/launch.test.ts` — `express` resolved from labels when the request omits it,
  an explicit `false` beating a labelled ticket, and the flag recorded on `SessionMeta`.
- `tests/server/qaVerdict.test.ts` — all three approve variants set To Merge; `reject` still
  comments before the status write and rejects an empty reason.
- `tests/server/ticketVerdict.test.ts` — the new args validate, a ticket not at To QA still
  409s, and `supersedeStaleSession` runs before the launch.
- New `tests/server/verdictRoute.test.ts` (shaped after `assigneeRoute.test.ts` /
  `reviewScaleRoute.test.ts`) — `approve-local` and `approve-mr` launch To Merge with the
  matching `trailingArg`; bare `approve` launches nothing; `reject` launches To Code.
- `tests/server/autoAdvance.test.ts` — `stageAdvanced("Backlog", "To QA")` is true, beside
  the pinned `To Code → To QA` case.
- `tests/lib/stageDefaults.test.ts` and `tests/lib/status.test.ts` must stay green with the
  new `Express` profile entry.

## Out of scope

- **Collapsing design and implementation for normal tickets.** Measured: the design session
  ends at 143k–221k of context, and carrying that prefix through 120–216 implementation
  turns costs an estimated +2.5M–4.3M input equivalent per ticket, against the ~50–80k saved
  by skipping one session boot — before counting the auto-compaction it would guarantee. The
  plan file is the compression boundary, and superpowers' own `executing-plans` exists for
  "a separate session" for this reason.
- **Trimming the design stage's own context** (delegating exploration to subagents so the
  brainstorm transcript stays small). The largest single measured cost in the sample was a
  stage session at 5.8M input equivalent, so this is probably the next-largest lever — but
  it is a change to how brainstorming is run, not to how many steps the flow has.
- **A size-based fast path.** The original framing keyed express off `SMALL_DIFF_LINES`;
  the evidence says the bypass is not size-driven, so size survives only as one of the
  express escalation criteria.
- **Auto-labelling `Express` from `lime-new`'s mini-analysis.** Plausible and cheap, but it
  would put a triage decision in the one stage that cannot yet see the repo.
- **Unifying `lime-merge`'s and `lime-rebase`'s duplicated rebase/review block**, flagged at
  `lime-merge:38` and now tracked as RIC-170.
