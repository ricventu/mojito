# Per-state model & effort defaults, configurable via UI

## Problem

Auto-advance carries the **model** the user picked in the prior stage into the next
stage. `runAutoAdvance` (`src/server/autoAdvanceRunner.ts:21-22`) sets
`effort: defaultEffortForStatus(newStatus)` (per-stage optimal) but
`model: prev.model` (inherited). So a To-Code session the user launched with `fable`
carries `fable` into the To-Review **code-review** stage — where a weak model is exactly
wrong. Effort is already chosen per stage; model is not.

Additionally, neither the per-stage model nor the per-stage effort is configurable at
runtime — effort is a hardcoded table (`EFFORT_OF_STATUS` in `autoAdvance.ts`) and model
has no per-stage notion at all (the launch UI just defaults every stage to `opus`).

## Goals

1. Auto-advance launches each stage with that stage's **default model** (not the inherited
   one) and its default effort.
2. Per-state defaults (model + effort) live in an editable config file and are seeded from
   built-in values.
3. A Settings UI lets the user view and change the per-state model/effort table.
4. The manual LaunchSheet pre-fills **both** model and effort from the per-state default
   (effort already does; model now does too), still overridable per launch.

Non-goal: changing the rebase session's fixed `xhigh` effort, or the terminal/custom-session
model behavior. Only the 6 launchable lifecycle statuses are configured.

## Configured statuses

The 6 launchable lifecycle statuses: `Backlog`, `Todo`, `To Code`, `To Review`, `To QA`,
`To Merge`. Terminal states (`Done`/`Canceled`/`Duplicate`) never launch, so they are not
configured. `Backlog` and `Todo` are both design stage 1 with identical defaults; the UI
presents them as **one "Backlog/Todo" row** that writes both keys, but storage is keyed by
individual status name (so resolvers stay a simple `Record<string, …>` lookup).

## Built-in seed defaults

Derived from each stage's cognitive load and downstream risk (effort keeps the current
`EFFORT_OF_STATUS` values, already tuned; model is `opus` where reasoning quality matters and
`fable` only for the one mechanical stage):

| Status         | model | effort | rationale |
|----------------|-------|--------|-----------|
| Backlog / Todo | opus  | xhigh  | Design (brainstorm/debug → plan). Highest stakes — a bad plan poisons everything downstream. |
| To Code        | opus  | high   | Subagent-driven implementation; subagents do the heavy lifting but the orchestrator's dispatch/integrate/test judgment matters. |
| To Review      | opus  | xhigh  | Read-only code review; depth pays, no over-engineering risk. This is exactly where a weak model (the inherited `fable`) was wrong. |
| To QA          | fable | low    | Human-approval gate: print a summary, dispatch on the verdict, set status. Mechanical — a strong model is wasted here. |
| To Merge       | opus  | xhigh  | Usually procedural, but a content-changing rebase runs a merge-gating inline review + fixes with no re-QA behind the clean path — same profile as To Review. |

Statuses outside this table fall back to `opus` / `high` (the app-wide default), preserving
the current `defaultEffortForStatus` fallback behavior.

## Storage

New file `~/.config/mojito/stage-defaults.json` (honor `XDG_CONFIG_HOME` if set, else
`~/.config`; overridable via `MOJITO_CONFIG_DIR` for tests). Shape — a partial map, only the
keys the user has changed need be present:

```json
{
  "To Code": { "model": "sonnet", "effort": "high" },
  "To QA":   { "model": "opus",   "effort": "medium" }
}
```

Missing file, missing key, or an invalid value → fall back to the built-in seed. The file is
the **override layer**; built-ins are the base. Loaded lazily and cached in-process; the
cache is invalidated on write. Single Next.js process, so a simple module-level cache is
sufficient — no cross-process concern.

## Modules

**`src/lib/stageDefaults.ts`** (client + server safe, pure — no file I/O):
- `BUILTIN_STAGE_DEFAULTS: Record<string, { model: string; effort: Effort }>` — the seed
  table above (with the effort rationale comment moved here from `autoAdvance.ts`).
- `LAUNCHABLE_STATUSES: string[]` — the 6 keys.
- `STAGE_DEFAULT_ROWS` — UI row descriptors, e.g.
  `[{ label: "Backlog/Todo", statuses: ["Backlog","Todo"] }, { label: "To Code", statuses: ["To Code"] }, …]`.
- `MODELS` / `EFFORTS` constant lists (moved here from LaunchSheet so UI + validation share one source).
- `resolveModel(status, overrides?)` / `resolveEffort(status, overrides?)` — pure lookups:
  `overrides[status]?.model ?? BUILTIN[status]?.model ?? "opus"` (and `"high"` for effort).
- `mergeEffective(overrides): Record<string,{model,effort}>` — built-ins merged with overrides,
  for the GET response.

**`src/server/stageDefaults.ts`** (server only — file I/O + cache):
- `configPath()` — computes the JSON path.
- `readOverrides()` — reads + parses the file (cached), tolerating missing/corrupt file (→ `{}`).
- `readEffective()` — `mergeEffective(readOverrides())`.
- `writeOverrides(next)` — validates + persists (mkdir -p the dir), invalidates cache.
- `defaultModelForStatus(status)` / `defaultEffortForStatus(status)` — config-aware resolvers
  used by the launch path.

**`src/server/autoAdvance.ts`**: keeps `STAGE_OF`, `stageOf`, `stageAdvanced`,
`decideAutoAdvance`, `GATE_STATES`, `TERMINAL_STATES`, `KNOWN_STATUSES`. The
`EFFORT_OF_STATUS` table and `defaultEffortForStatus` **move out** — effort built-ins to
`lib/stageDefaults.ts`, the config-aware `defaultEffortForStatus` to `server/stageDefaults.ts`.
(CLAUDE.md's contract only pins `STAGE_OF` to this file; it stays.)

## Wiring

- **`autoAdvanceRunner.ts`**: `model: defaultModelForStatus(newStatus)` (was `prev.model`);
  `effort: defaultEffortForStatus(newStatus)` now resolves via config. This is the bug fix.
- **`LaunchSheet.tsx`**: fetch the effective table once (see hook below) and prefill both
  `model` and `effort` from it for `ticket.statusName`, with the built-in as the instant
  fallback before the fetch resolves. `MODELS`/`EFFORTS` now imported from `lib/stageDefaults.ts`.
- **`tests/server/autoAdvance.test.ts`**: update the `defaultEffortForStatus` import to its
  new home; the assertions (built-in behavior when no config file) are unchanged.

## API

New route `src/app/api/config/stage-defaults/route.ts`, token-guarded like the others:
- `GET` → `NextResponse.json(readEffective())` — the merged effective table.
- `PUT` → body is a partial `Record<status, {model, effort}>`. Validate: every key ∈
  `LAUNCHABLE_STATUSES`, every `model` ∈ `MODELS`, every `effort` ∈ `EFFORTS`; reject with
  422 otherwise. Persist via `writeOverrides`, return the new effective table.

## UI

- **`src/lib/useStageDefaults.ts`** — small hook: GET `/api/config/stage-defaults`, expose
  `{ defaults, loading, save(next) }` where `save` PUTs and refreshes. Used by both the
  Settings sheet and LaunchSheet prefill.
- **`src/components/SettingsSheet.tsx`** — a sheet (same `sheet-backdrop`/`sheet` styling as
  LaunchSheet) with one row per `STAGE_DEFAULT_ROWS` entry, each a Model + Effort `<select>`
  pair, plus Save / Close. Save calls the hook, shows an error on failure.
- **Entry point** — a small gear button in `page.tsx`'s `<nav>` (or the header area) that
  opens the Settings sheet. State (`settingsOpen`) lives in `Home`.

## Testing

`tests/server/stageDefaults.test.ts` (drive via `MOJITO_CONFIG_DIR` → temp dir):
- No file present → `readEffective` equals the built-in seed; `defaultModelForStatus`/
  `defaultEffortForStatus` return built-ins.
- File with a partial override → those keys override, others stay built-in.
- Corrupt/unparseable file → treated as no overrides (built-ins), no throw.
- `writeOverrides` then `readEffective` reflects the change (cache invalidated).
- Validation: writing an invalid model/effort/status is rejected.

`tests/server/autoAdvance.test.ts`: existing effort assertions still pass from the new import.

Add a focused test that `runAutoAdvance` builds its launch request with
`defaultModelForStatus(newStatus)` rather than `prev.model` — either a unit test on a small
extracted helper or by asserting the `launchSession` request in the existing runner test
harness.

Run: `npx tsc --noEmit && npx vitest run`.
