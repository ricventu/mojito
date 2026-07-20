# Plain zsh terminal launch (RIC-155)

## Problem

Everywhere Mojito offers to launch a custom (bare interactive) `claude` session, it should
also offer to launch a **plain `zsh` terminal** — a normal login shell, no `claude`, no
lifecycle. Useful for poking around a project or a ticket's worktree without a claude
session.

Linear ticket: RIC-155 "Avvio terminale". Original brief (Italian): *"Nei punti in cui c'è
avvia sessione custom claude, dare anche la possibilità di avviare un terminale normale
zsh."* → "In the places that offer launching a custom claude session, also offer launching
a normal zsh terminal."

## Context: how launches work today

All session launches share one path:

- **API**: `POST /api/sessions` (`src/app/api/sessions/route.ts`) dispatches by the request
  body's `kind` field.
- **tmux primitive**: `newSession(name, cwd, command)` in `src/server/tmux.ts` →
  `tmux new-session -d -s <name> -c <cwd> <command>`. This is the single seam where the
  in-tmux command is chosen. Today every command is a `claude …` invocation.
- **Session kinds** (`SessionMeta.kind` in `src/server/types.ts`): `"lime" | "custom" |
  "rebase"`. `"custom"` is a bare interactive `claude` — the closest analog to a plain
  terminal.

The **custom** flow is the template we mirror:

- UI entry points (both offer a custom claude session):
  - `src/components/NewSessionSheet.tsx` — Sessions tab, project-scoped (or "General
    (home)"). Posts `{ kind: "custom", projectName, model, effort }`.
  - `src/components/LaunchSheet.tsx` — Tickets tab, the `Custom session` button
    (`startCustom`). Posts `{ kind: "custom", ticket, status, projectName, title, labels,
    model, effort }`, cwd = the ticket's worktree.
- Server: `buildCustomClaudeCommand` + `launchCustomSession` in `src/server/launch.ts`.
  `launchCustomSession` resolves cwd (ticket→worktree, else project path, else `homedir()`),
  writes a hook-settings file always, writes a launch-context file only when ticket-scoped,
  builds the command, calls `newSession` + `pipePane`, and `registry.upsert`s the meta.
- Naming: `customSessionName(slug, unique)` → `mojito-custom-<slug>-<unique>`
  (`src/server/sessionKey.ts`).
- Grouping/rendering: `src/lib/sessionFilter.ts` maps `kind === "custom"` to the synthetic
  `CUSTOM_STATUS`; `src/lib/status.ts` defines `CUSTOM_STATUS = "Custom"` and its hue;
  `src/components/SessionList.tsx` renders custom sessions title-first and hides the `auto:`
  toggle (that toggle is `kind === "lime"` only).

**Key caveat.** Session `state` (`SessionState` in `types.ts`) is driven entirely by
`claude` hooks POSTing to `/api/hook`. A plain shell fires no hooks, so nothing would ever
advance it off `"starting"`. `registry.recover(liveSessionNames)` only flips a non-`done`
session to `"failed"` when its tmux session is gone.

## Chosen approach

Add a **new first-class `kind: "shell"`** that mirrors the custom path minus every
claude-specific concern (no hook-settings file, no launch-context file, no model/effort).
Rejected alternatives: reusing `kind: "custom"` with a sub-flag (muddies custom semantics,
sprinkles conditionals through every custom branch) and generalizing to an arbitrary
`command` field (YAGNI for "launch a zsh terminal").

## Design

### Session kind & naming

- Extend the `SessionMeta.kind` union in `src/server/types.ts` with `"shell"`.
- `sidecar.ts` back-compat default (missing `kind` → `"lime"`) is unaffected.
- Add `shellSessionName(slug, unique)` → `mojito-shell-<slug>-<unique>` in
  `src/server/sessionKey.ts`. Keeps the `mojito-` prefix so `listSessions("mojito-")` and
  the sweep continue to see it.
- `model` and `effort` are left empty strings for shell sessions (meaningless for a plain
  shell).

### Server (`src/server/launch.ts`)

- `buildShellCommand()` — pure, returns the shell command string: **`zsh -l`** (login +
  interactive, so it sources the user's profile and behaves like a normally-opened
  terminal). No `envPrefix`, no `--settings`, no slash command.
- `launchShellSession(req, deps)` — mirrors `launchCustomSession`:
  - Same cwd resolution: ticket → its worktree; else the project path; else `homedir()`
    with slug `"general"`.
  - `id = shellSessionName(slug, genId())`.
  - **Writes no hook-settings file and no launch-context file.**
  - `command = buildShellCommand()`.
  - `newSession(id, cwd, command)` then `pipePane(id, logfile)`.
  - `registry.upsert(meta)` with `kind: "shell"`, `state: "running"` (see State below),
    empty `model`/`effort`, empty `ticket`/`launchStatus` when project-scoped (or the ticket
    fields when ticket-scoped), `title`, `projectName`, `cwd`, `createdAt`.
  - Request shape: same optional fields as custom — `{ projectName?, ticket?, status?,
    title?, labels? }` — reusing the custom request type or a shell-specific subset.

### API (`src/app/api/sessions/route.ts`)

- Add a `body.kind === "shell"` branch **before** the lime fallthrough → `launchShellSession`.
- Responds `201 { meta }` on success, `422 { error }` on a resolution failure — same
  contract as the custom branch.

### UI — toggle inside the sheet

Both `NewSessionSheet.tsx` (Sessions tab) and `LaunchSheet.tsx` (Tickets tab) gain a
`Claude | Terminal` segmented toggle at the top.

- Default = Claude (current behavior, unchanged).
- Selecting **Terminal**:
  - hides the model and effort selectors;
  - the submit posts `{ kind: "shell", … }` instead of `{ kind: "custom", … }`, carrying the
    same scope fields (project for the Sessions tab; ticket/status/title/labels for the
    ticket sheet).
- In `LaunchSheet`, the toggle sits with the existing `Custom session` control; Terminal
  mode launches a plain shell in the ticket's worktree. The lime lifecycle buttons
  (`Start session`, verdicts, rebase) are unchanged.

### State

Shell sessions are created with `state: "running"` and never transition via hooks (they fire
none). `registry.recover` still flips a shell to `"failed"` when its tmux session is gone
(e.g. the user exited the shell and the card is stale). No new `SessionState` value is
introduced.

### Grouping & rendering

- New **"Terminal"** bucket: add a `TERMINAL_STATUS = "Terminal"` constant (parallel to
  `CUSTOM_STATUS`) in `src/lib/status.ts` with its own hue via `statusColorClass`.
- `src/lib/sessionFilter.ts`: map `kind === "shell"` to `TERMINAL_STATUS` (parallel to the
  existing `kind === "custom"` → `CUSTOM_STATUS`).
- `src/components/SessionList.tsx`: render shell sessions title-first like custom, show a
  `terminal` chip (parallel to the existing `rebase` chip), and hide the `auto:` toggle
  (already lime-only). Title = the ticket title when ticket-scoped, else the project name
  (or "General").

### Lifecycle compatibility (verified against existing code, no change expected)

- **Attach/view**: `TerminalView.tsx` → `ptyGateway.attachPty` runs `tmux attach-session -t
  <id>`, which works for any tmux session including a bare shell. Confirm no claude-specific
  assumption blocks rendering a shell card; if the card shows model/effort, guard those on
  kind.
- **Delete**: `DELETE /api/sessions/[id]` → `closeSession` sends `C-c` then `C-d` (exits an
  idle zsh) with a `kill-session` fallback — compatible.

## Testing

Unit tests mirroring the existing custom-session tests under `tests/server/`:

- `buildShellCommand` emits `zsh -l`; contains no `claude`, no `--settings`, no slash
  command.
- `shellSessionName` → `mojito-shell-<slug>-<unique>`.
- `launchShellSession`: cwd resolution for all three cases (ticket→worktree, project path,
  homedir); **no** hook-settings file and **no** context file written; meta has
  `kind: "shell"`, `state: "running"`, empty model/effort.
- API dispatch: `kind === "shell"` routes to the shell launcher; `201`/`422` contract.
- `sessionFilter`: `kind === "shell"` buckets under `TERMINAL_STATUS`.

Full gate: `npx tsc --noEmit && npx vitest run`.

## Out of scope (YAGNI)

- Arbitrary / user-supplied commands.
- Non-zsh shells or shell selection.
- Per-shell environment configuration.
