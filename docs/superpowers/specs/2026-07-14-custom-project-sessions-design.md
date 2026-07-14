# Custom (non-ticket) sessions — design (RIC-115)

## Problem

Today every Mojito session is bound to a Linear ticket + status and runs
`claude … /lime-next <TICKET>` under the lime lifecycle. There is no way to launch a
plain `claude` session scoped to a project's working directory (or a general one in the
home directory) from the UI.

RIC-115: add the ability to create a **custom session** for a project — or a general one.
If a project is selected, the terminal opens in that project's folder; otherwise in the
home directory. The projects offered are those **mapped in lime's config**
(`~/.claude/lime-projects.json`).

## Scope & non-goals

- **Mojito-only.** The shared Mojito↔lime contract (launch-context sidecar, status/stage
  model) is untouched. No lime change, no plugin-cache rebuild.
- Custom sessions have **no lifecycle**: no stages, no status, no auto-advance.
- Not building: user-typed session names, an initial-prompt field, or a bare-shell mode
  (custom sessions always run plain `claude`).

## Decisions (from brainstorming)

1. A custom session runs **plain `claude`** (interactive) in the chosen folder — no
   `/lime-next`, no launch context, no auto-advance.
2. The project picker lists the projects **mapped in `~/.claude/lime-projects.json`**, each
   already carrying its folder path. "General" → home directory. No Linear call.
3. Custom sessions get **full state tracking** via the same hook settings as lime sessions
   (running / needs-input / done badges + alerts), minus lifecycle/auto-advance.
4. Entry point: a **`+ New session` button** in the Sessions-tab header (next to
   *Clean up*).
5. The card **label is derived from the Claude session name** — specifically the hook
   payload's `session_title` field (the name shown in `claude --resume`), a documented,
   stable surface. Transcript-JSONL parsing is explicitly rejected: the format is internal
   and version-unstable, and short sessions may never produce a `summary` entry. Until a
   `session_title` arrives the label falls back to the working-folder basename (or
   `"home"`).

## Architecture

### Data model (`src/server/types.ts`)

Add a discriminator to `SessionMeta`:

```ts
kind: "lime" | "custom";
```

- Persisted sidecars written before this change lack `kind`; every reader defaults a
  missing value to `"lime"` (see *Backward compatibility*).
- `launchSession` (lime) now stamps `kind: "lime"`.

A **custom** session's `SessionMeta`:

| field          | value                                             |
|----------------|---------------------------------------------------|
| `kind`         | `"custom"`                                         |
| `id`           | `mojito-custom-<projslug\|general>-<genId()>`      |
| `ticket`       | `""`                                               |
| `launchStatus` | `""`                                               |
| `model`,`effort`| from the launch request                          |
| `autoAdvance`  | `false`                                            |
| `state`        | `"starting"`                                        |
| `cwd`          | mapped project path, or home directory             |
| `projectName`  | selected project name, or `null` (General)         |
| `title`        | fallback label (folder basename, or `"home"`)      |
| `labels`       | `[]`                                               |

### Session key (`src/server/sessionKey.ts`)

```ts
export function customSessionName(slug: string, unique: string): string;
// => `mojito-custom-${slug}-${unique}`
```

- `slug` = `statusSlug(projectName)` when a project is chosen, else `"general"`.
- `unique` = short random hex (from an injected `genId` — see *Launch*).
- Custom sessions **do not dedup**: each launch gets a fresh id. The `mojito-` prefix is
  preserved so `listSessions`, sweep, and the registry pick them up unchanged.

### Project list (`src/server/limeProjects.ts`)

```ts
export function listMappedProjects(map: ProjectMap): { name: string; path: string }[];
export function resolvePathForProject(map: ProjectMap, name: string): string | null;
```

- `listMappedProjects` flattens every map entry into `{name, path}`:
  - object entry with `projects` → one `{name, path}` per project;
  - object entry with a `path` and no `projects` → `{name: <teamKey>, path}`;
  - string entry → `{name: <teamKey>, path: <value>}`.
  Results sorted by `name`.
- `resolvePathForProject` returns the path for a project name across all entries, else
  `null`.

New route `GET /api/projects` (auth-gated, mirrors `/api/tickets`): returns
`{ projects: string[] }` (names only; the client never needs the path — the server
resolves cwd at launch).

### Launch (`src/server/launch.ts`)

New sibling to `launchSession`:

```ts
export interface CustomLaunchRequest { projectName: string | null; model: string; effort: Effort; }

export function buildCustomClaudeCommand(req: CustomLaunchRequest, settingsPath: string): string;
// `claude --model '<model>' --effort '<effort>' --settings '<settingsPath>'`  (no /lime-next)

export async function launchCustomSession(
  req: CustomLaunchRequest,
  deps: LaunchDeps & { genId?: () => string; homeDir?: () => string },
): Promise<{ ok: true; meta: SessionMeta } | { ok: false; reason: "no-repo" }>;
```

Steps:
1. Resolve cwd: `projectName` → `resolvePathForProject(map, projectName)`; if it doesn't
   resolve → `{ ok: false, reason: "no-repo" }`. `projectName === null` (General) →
   `homeDir()` (default `os.homedir`).
2. `id = customSessionName(slug, genId())` (default `genId` = 6-char hex).
3. Write hook settings via `buildHookSettings(id, port, token)` (identical to lime).
4. **No** `writeLaunchContext`.
5. `command = buildCustomClaudeCommand(req, settingsPath)`.
6. `newSession(id, cwd, command)`, then `pipePane`.
7. `registry.upsert(meta)` with the custom meta above; initial `title` =
   `basename(cwd)`, or `"home"` when `cwd === homeDir()`.

`POST /api/sessions` branches on `body.kind === "custom"` → `launchCustomSession`,
else the existing `launchSession`. A `no-repo` result → 422.

### Label from hook (`src/app/api/hook/route.ts`, `src/server/hookHandler.ts`)

- The route currently drains and discards the body (`await req.text()`). Change it to read
  the body and best-effort `JSON.parse` it; extract `session_title` (string) and pass it to
  `handleHook`.
- `handleHook` gains an optional `payload?: { sessionTitle?: string }` argument:
  - **Custom sessions** (`meta.kind === "custom"`): skip the `getIssueStatus` /
    `stageAdvanced` / auto-advance path entirely (no ticket, no lifecycle). Compute the
    state via `mapHook(event, false)`, except **`SessionEnd` → `done`** (a closed custom
    session is finished, not failed). When `payload.sessionTitle` is a non-empty string and
    differs from `meta.title`, patch `title` and let the normal `session.state` emit refresh
    the UI.
  - **Lime sessions**: unchanged — `title` comes from Linear and is never overwritten here.

### UI

- **`src/components/SessionList.tsx`** — add a `+ New session` button in the header
  (alongside *Clean up*) that opens `NewSessionSheet`. Card rendering branches on
  `s.kind === "custom"`:
  - primary line = `s.title` (the session name) with a `custom` chip, no `ticket` id;
  - no `launchStatus` line; no auto-advance toggle;
  - `dismiss` confirm text uses `s.ticket || s.title`.
  Grouping by `projectName` is unchanged (custom-with-project groups under the project;
  General under the existing "No project" bucket).
- **`src/components/NewSessionSheet.tsx`** (new) — fetches `/api/projects` on open; renders
  a project `<select>` (with a *General (home)* option mapping to `projectName: null`), a
  model `<select>`, an effort `<select>`, and a **Start session** button. POSTs
  `{ kind: "custom", projectName, model, effort }` to `/api/sessions`, then
  `onLaunched()` + close. Mirrors `LaunchSheet`'s styling and error handling.

### Guards (`src/server/autoAdvance.ts` / `autoAdvanceRunner.ts`)

Custom sessions must never auto-advance. `autoAdvance` is already `false` for them (so
`decideAutoAdvance` returns no-launch), and `handleHook`'s custom branch never calls
`onAutoAdvance`. Add an explicit early-out for `kind === "custom"` in the runner as
defense-in-depth.

## Backward compatibility

`SessionMeta.kind` is new. Sidecars written before this change omit it. `readSidecar`
(`src/server/sidecar.ts`) is the single hydration point — the registry loads all sessions
through `listSidecars` → `readSidecar` at construction and re-reads via `readSidecar` in
`patch`. Default a missing `kind` to `"lime"` there, so existing lime sessions load and
render exactly as before with no per-caller guards.

## Testing (`tests/server/`)

- `limeProjects`: `listMappedProjects` flattens object-with-`projects`, object-with-`path`,
  and string entries; sorted; `resolvePathForProject` hits across entries and returns
  `null` when unmapped.
- `sessionKey`: `customSessionName` format and that distinct `unique` values yield distinct
  ids.
- `launch`: `launchCustomSession` resolves cwd to the mapped project path and to the home
  directory for General; the command contains no `/lime-next`; no launch-context file is
  written; hook settings are written; the registry meta has `kind:"custom"`, empty
  `ticket`, `autoAdvance:false`; the id is unique via an injected `genId`; unmapped project
  → `no-repo`.
- `hookHandler`: for a custom session, a hook with `sessionTitle` patches `title` and emits;
  `getIssueStatus` is never called; `SessionEnd` yields `done`; a lime session's `title` is
  never overwritten.
- `autoAdvance`: a custom session is skipped by the runner.

All under `npx tsc --noEmit && npx vitest run`.

## Files touched

- `src/server/types.ts` — add `kind`.
- `src/server/sessionKey.ts` — `customSessionName`.
- `src/server/limeProjects.ts` — `listMappedProjects`, `resolvePathForProject`.
- `src/server/launch.ts` — `launchCustomSession`, `buildCustomClaudeCommand`, `kind` on lime meta.
- `src/server/hookHandler.ts` — custom branch + `sessionTitle` patch.
- `src/app/api/hook/route.ts` — parse body, forward `session_title`.
- `src/app/api/sessions/route.ts` — branch on `kind`.
- `src/app/api/projects/route.ts` — new.
- `src/server/sidecar.ts` — `readSidecar` defaults missing `kind` to `"lime"`.
- `src/server/autoAdvanceRunner.ts` — skip custom.
- `src/components/SessionList.tsx` — button + custom card rendering.
- `src/components/NewSessionSheet.tsx` — new.
