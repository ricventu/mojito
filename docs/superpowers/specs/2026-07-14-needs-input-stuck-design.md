# Needs-input badge stays stuck until done (RIC-117)

## The bug

Once a session's badge flips to **needs input**, it never returns to **running**: it stays
"needs input" from the moment it is first signalled until the stage completes (`done`). The
badge no longer reflects reality — the agent is actively working again (the user answered,
granted permission, or the agent resumed via subagents) but the UI still shows "needs input".

## Root cause

Session state is driven entirely by Claude Code hooks. `mapHook`
(`src/server/hookMap.ts`) maps each hook event to a `SessionState`, and
`buildHookSettings` (`src/server/hookSettings.ts`) decides **which** events are actually
wired to fire for a session:

- **Always delivered** (`EVENTS`): `SessionStart`, `PermissionRequest`, `Notification`,
  `Stop`, `SessionEnd`.
- **Scoped to `AskUserQuestion`** (`MATCHED_EVENTS`): `PreToolUse`, `PostToolUse`.

Cross-referencing the delivered events with their `mapHook` results, the transitions that
land on **`running`** are:

- `SessionStart` → `running` — but this only fires **once, at boot**.
- `PostToolUse` → `running` — but it is **matched to `AskUserQuestion` only**, so it fires
  only when the agent's `AskUserQuestion` tool call completes.

Every other way a session enters `needs-input` has **no wired event that returns it to
`running`** when the human unblocks it and the agent resumes:

| needs-input trigger                         | how the human unblocks   | wired "resumed" event? |
|---------------------------------------------|--------------------------|------------------------|
| `Notification` (idle, waiting for input)    | types a prompt           | none → **stuck**       |
| `PermissionRequest` (tool approval)         | approves the dialog      | none → **stuck**       |
| `Stop` with no stage advance ("waiting")    | types the next prompt    | none → **stuck**       |
| `PreToolUse` (`AskUserQuestion`)            | answers the question     | `PostToolUse` → running ✓ |

So the only `needs-input` that ever clears is the `AskUserQuestion` case. Idle
notifications, permission grants, and post-`Stop` continuation — the common cases in a
Mojito-launched `lime` session running under default permissions — stay `needs-input` for
the rest of the stage. This is not a state-guard bug: `Registry.patch` overwrites state
freely; the gap is purely which hooks are wired.

This was verified empirically against `mapHook`: among the always-delivered events, only
`SessionStart` yields `running`; a `PermissionRequest` followed by a `Stop` stays
`needs-input`.

### Verified Claude Code hook semantics (the fix relies on these)

- `UserPromptSubmit` fires when the user submits a prompt in the main input box, before
  Claude processes it. It does **not** fire when the user approves a permission dialog.
- `PostToolUse` with the `matcher` **omitted** fires for **all** tools, and fires for tool
  calls made **inside subagents** too (with `agent_id` set). The `matcher` filters by tool
  name; omitting it (or `"*"`) matches every tool.
- `PreToolUse`/`PostToolUse` matched to `AskUserQuestion` fire only for that tool.

## The fix

Add the missing "agent is working again" signals so `needs-input` clears when the human
unblocks the session:

1. **Wire `UserPromptSubmit` → `running`.** The instant the user submits a prompt (an idle
   `Notification`, a plain-text answer, or the next instruction after a `Stop`), the session
   is no longer waiting → `running`. Immediate, before any tool runs.
2. **Broaden `PostToolUse` to all tools → `running`** (move it from `MATCHED_EVENTS` to
   `EVENTS`, i.e. drop the `matcher`). Any completed tool call means the agent is working —
   this clears a `needs-input` left by a permission grant (the granted tool's `PostToolUse`)
   and keeps the badge accurate while subagents run during Stage 2. `mapHook` already maps
   `PostToolUse → running`, so no mapping change is needed for it.
3. **Keep `PreToolUse` scoped to `AskUserQuestion` → `needs-input`.** This is the immediate
   "the agent is asking a question" signal and must stay tool-specific (a generic
   `PreToolUse` would wrongly flip every tool call to `needs-input`).

Together these close every path: typed input clears immediately via `UserPromptSubmit`;
permission grants and any resumed/subagent tool activity clear via the broadened
`PostToolUse`; `AskUserQuestion` still shows `needs-input` on ask and clears on answer.

Legitimately-blocked states are preserved: a `Stop` with no stage advance stays
`needs-input` (the agent genuinely finished its turn and is waiting), and an idle
`Notification` with no user response stays `needs-input` until the user acts.

## Non-goals

- No change to how `needs-input` is **entered** (`Notification`, `PermissionRequest`,
  `PreToolUse`/`AskUserQuestion`, `Stop`-no-advance all keep their current meaning).
- No new `SessionState`, no state-transition guard in `Registry`, no UI/badge change.
- No change to the `Stop`/`SessionEnd` status-advance logic in `handleHook`.

## Trade-off (accepted)

Broadening `PostToolUse` means one fire-and-forget localhost hook call per tool call
(including subagent tool calls). The existing command is `curl -sS -m 2 … || true`, so it
never blocks the agent, and `handleHook` patching to `running` is idempotent. For a local
single-user dev tool this traffic is acceptable and is the cost of an accurate live badge.
The team's original concern — that a generic hook must not *drive `needs-input`* — is
respected: only `PreToolUse` (still `AskUserQuestion`-scoped) maps to `needs-input`;
`PostToolUse` maps to `running`.

## Touch points

- `src/server/types.ts` — add `"UserPromptSubmit"` to `HookEventName`.
- `src/server/hookMap.ts` — add `case "UserPromptSubmit"` → `running`; refresh the
  `PostToolUse` comment (now "any tool finished").
- `src/server/hookSettings.ts` — add `UserPromptSubmit` to `EVENTS`; move `PostToolUse` out
  of `MATCHED_EVENTS` into `EVENTS` (drop matcher); leave `PreToolUse` matched to
  `AskUserQuestion`.
- `src/app/api/hook/route.ts` — add `"UserPromptSubmit"` to the `VALID` whitelist.
- Tests: `tests/server/hookHandler.test.ts` (regression: needs-input clears on
  `UserPromptSubmit` and on a generic `PostToolUse`), `tests/server/hookSettings.test.ts`
  (PostToolUse now unmatched; `UserPromptSubmit` present).

## Testing

- Unit (`mapHook`): `UserPromptSubmit` → `{ state: "running", alert: null }`.
- Unit (`buildHookSettings`): `UserPromptSubmit` is wired in `EVENTS`; `PostToolUse` has no
  `matcher`; `PreToolUse` still matched to `AskUserQuestion`.
- Integration (`handleHook`): starting from `needs-input`, a `UserPromptSubmit` flips the
  session to `running` and clears the message; a `PostToolUse` (any tool) flips it to
  `running`. A `Stop` with no advance still lands on `needs-input`.
- Manual: launch a session, trigger a permission prompt (badge → needs input), approve it,
  confirm the badge returns to running once the agent runs the next tool; type a prompt and
  confirm it returns to running immediately.

---

## Follow-up (2026-07-15): the terminal case the first fix missed

**Symptom reported after merge:** a session that has finished its stage — e.g. a Stage 5
run that reaches **Done** and prints "Lifecycle finished" — still shows the **needs input**
badge. The very state the ticket is about is still stuck, now at the *end* of a session
instead of mid-run.

**Root cause (why the first fix was incomplete).** `mapHook` was **stateless**: it mapped
`(event, statusAdvanced)` → state without considering the session's *current* state. The
first fix reasoned only about clearing `needs-input` **while the agent is still working**
(`UserPromptSubmit`/`PostToolUse` → running) and deliberately left an idle `Notification`
mapping to `needs-input` (see "Legitimately-blocked states" above). But it never reasoned
about a `Notification` arriving **after** a session is already `done`:

1. The stage completes → `Stop` with a stage advance → `done` (badge correct).
2. The prompt sits idle; Claude Code fires an idle `Notification` ~60s later.
3. `mapHook("Notification")` unconditionally returns `needs-input`, clobbering `done`.
4. Nothing clears it — the lifecycle is over, so no further `PostToolUse`/`UserPromptSubmit`
   arrives. The badge sticks on **needs input** forever.

This also hits gate stops (a `To QA`/`To Merge` handoff with auto-advance off lands on
`done`, then the idle `Notification` flips it) and every completed session that lingers.

**The fix.** Make the state machine **terminal-state-aware**:

1. `mapHook` takes the session's `currentState`. When it is terminal (`done`/`failed`), a
   **passive** signal (idle `Notification`, a late `PermissionRequest`/`PreToolUse`, a stray
   `Stop`) leaves the terminal state unchanged. Only an **activity** signal
   (`SessionStart`/`UserPromptSubmit`/`PostToolUse`) revives a finished session to `running`
   — so a user can still reuse a done session by typing a new prompt.
2. `handleHook` gates auto-advance on `statusAdvanced` (a genuine fresh Stop/SessionEnd
   handoff), not merely `outcome.state === "done"`. Otherwise a passive event that *preserves*
   `done` would re-read the stale `launchStatus` and relaunch a duplicate stage.

No hook **wiring** change is needed (`Notification` was already delivered), so unlike the
first fix this corrects **already-running** sessions immediately — no relaunch required.

**Non-goals (unchanged):** no new `SessionState`, no `Registry` guard, no UI/badge change.

**Testing (added).** Unit (`mapHook`): a `Notification` on a `done`/`failed` session keeps
that state with no alert; `UserPromptSubmit`/`PostToolUse` still revive a `done` session to
`running`. Integration (`handleHook`): a `Notification` on a `done` session stays `done`,
emits no `needs-input`, and never re-triggers auto-advance. Manual/QA: let a session finish
a stage, leave it idle past the notification timeout, and confirm the badge stays done
rather than flipping to needs input.
