# Quick commands (RIC-581)

## Intent

A **command** is a saved prompt with a name and an icon. Running it in a project starts a Claude
session there with that prompt: the routines a human would otherwise retype (clean merged
branches, update dependencies, review the last commit, …). Clean (RIC-528) is the first one: today
it is hard-coded; it becomes a command that ships by default, and the special case goes away.

## Goals

- Commands are configured in Settings. Each one is **global** (offered on every mapped project)
  or **bound to one project**.
- Running a command opens its session; **one session per command per project**: a tap while it is
  live reopens it (`alreadyOpen`, as Clean does today), never a second Claude on the same job.
- **AI help** in the command form: one button rewrites what is in the prompt field — a rough idea
  or a finished prompt — and proposes a name and an icon.
- **Default commands** ship with Mojito (`clean` for now), are present on a fresh install, can be
  edited, deleted and restored; a later version's new default appears on existing installs.
- Commands live on one instance; another instance can **import** them.

## Non-goals

- Commands for General (no project) or for a peer's projects in this client: the board is local,
  and a command runs in a project's checkout.
- Parameters/templating in a command's prompt (`{ticket}` and the like).
- Running a command on a schedule, or more than one session per command per project.
- Pushing commands to a peer.

## Anti-goals

- A project header that no longer fits on a 320 px phone.
- A second Claude started on the same command and project by a double tap.
- Any path by which this client writes a peer's settings (the relay's rule stays whole).

## Approaches

**Storage.** (a) A `commands` key in `settings`, like `favorites` — **picked**: partial
`PUT /api/settings` and `settings.updated` already carry a change to every device, and an import
is one read. (b) A `commands` table with CRUD routes: more routes and a migration, for history or
stats nothing asks for.

**AI help.** (a) One button in the form, a single Agent SDK call with no tools that returns
`{name, prompt, icon}` — **picked**: the result lands in the form to be edited, nothing leaves the
dialog. (b) A Claude session in the project that writes the command: it could read the repo, but a
terminal is heavy for a text field, and the session that runs the command reads the repo anyway.

**Session reuse.** One session per command per project (picked by the human) rather than a new
session on every run.

## Data

`packages/shared`:

```ts
interface Command {
  id: string;            // a default's word ("clean"), or "cmd-<hex6>" for a custom one
  name: string;          // trimmed, 1-40, unique case-insensitively across all commands
  prompt: string;        // 1-8000 (COMMAND_PROMPT_MAX)
  icon: CommandIcon;     // one of COMMAND_ICONS
  project: string | null; // null = every mapped project
  model: Model;
  effort: Effort;
}
interface CommandsSetting { items: Command[]; removed: string[] }
```

- **Ids** (my call). Two namespaces that never meet: a default's id is a plain word
  (`/^[a-z]+$/`, never `git`); a custom command's is `cmd-<6 random hex>`, made by the web when
  the dialog first saves it and never changed. So a later default can never take a custom
  command's id, and a custom command can never take a default's (a removed `clean` included).
  `CommandsSettingBody` accepts in `items` only a `DEFAULT_COMMANDS` id or the `cmd-` shape.
- `DEFAULT_COMMANDS: Command[]` (shared) holds the shipped defaults: today only
  `{ id: "clean", name: "Clean", icon: "brush-cleaning", project: null, model: "sonnet",
  effort: "high", prompt: CLEAN_PROMPT }`. `CLEAN_PROMPT` moves from
  `apps/server/src/sessions/prompt.ts` to shared, still pinned byte-for-byte by its test.
- The `commands` setting stores only what differs from the defaults, like `prompts`:
  `items` = custom commands and **edited copies of defaults** (same id); `removed` = ids of
  deleted defaults. On write, an item equal to its default is dropped, and a removed id that is
  not a default is dropped.
- `effectiveCommands(setting)` (shared, pure, unit-tested): each default in `DEFAULT_COMMANDS`
  order — the stored copy if any, skipped if removed — then the custom items in stored order.
  An **unedited** default (no stored copy) whose shipped name a stored command already uses (a
  later version shipping a name the human had taken) is left out: the human's own command wins,
  and nothing they saved turns into an "edited default". An edited default is never hidden by a
  name — hidden, it could be neither edited, reset nor restored (final review). Name uniqueness
  is validated on the effective list at write time, so a save never fails over a clash the human
  did not make.
  `Settings.commands` is the stored form (the form needs to know what is edited/removed); clients
  and the server both derive the effective list with this one function.
- `commandsFor(effective, project)`: the commands offered in a project — global ones and that
  project's own.
- `COMMAND_ICONS`: a curated list of ~40-50 lucide icon names (kebab-case), in shared so the
  server can validate the AI's pick; the web maps each name to its lucide component in one table
  (`lib/commandIcons.tsx`), guarded by a test that every name has a component.
- `CommandsSettingBody` (zod) validates the shape, uniqueness of ids and names, the icon, the id
  pattern; `SettingsBody.commands` is optional like the other keys. The stored value is read
  leniently (`readCommandsSetting`), not with this write-time schema: an item that no longer
  validates (an unknown icon becomes `zap`; a lowered cap, an unknown id, a repeated id or name) is
  dropped alone with one warning, and only a value that is no object or carries no lists is served
  empty — a rule change must never make the whole setting unreadable, or the next write would
  wipe it (final review).
- **Prompt cap** (final review): `COMMAND_PROMPT_MAX` = 8000 characters. The prompt is one argv
  entry of `tmux new-session`, and tmux refuses a command over ~16 KB ("command too long": 15 000
  characters run, 17 000 fail on tmux 3.7c), so a longer prompt would save but never run. The
  assist answer is held to it too (`ASSIST_PROMPT` asks for less; a longer one is a 502), and the
  dialog's textarea has `maxLength`.
- Project rename (`ProjectsRepo.rename` route) rewrites `project` on that project's commands in the
  same request; a project removal deletes its bound custom commands and drops any edited default
  bound to it (the shipped default comes back, global) — my call. Either change emits
  `settings.updated`. (Builder's call where in the route.)

## Running a command

- `POST /api/projects/:name/commands/:id` → 200 `{session, alreadyOpen}` (the type that is
  `CleanResult` today, renamed `CommandResult`). 404 when the project is not mapped or the command
  is not in `commandsFor(effective, name)`; 400 path missing; 409 as today (with `sessionId` when
  another live row holds the id).
- Server: `launchCommand(project, command)` = `launchProjectSession({ project, suffix: command.id,
  model, effort, prompt })` — fixed id `mj-<slug>-<command id>`, so Clean keeps
  `mj-<slug>-clean`, and a renamed command keeps its live session.
- Hyphenated slugs can collide (project `a` + `cmd-1a2b3c` and project `a-cmd`'s free session
  `mj-a-cmd-1a2b3c`). So `alreadyOpen` is answered only when the live row is this command's: same
  `project`, no ticket, kind `claude`; any other live row under that id is a 409 `{error,
  sessionId}`, never opened as the command's session.
- `launchClean`, `POST /projects/:name/clean` and the web's `lib/clean.ts` `cleanMessage` go;
  `GET /projects/:name/worktrees` stays (Clean's badge).
- The prompt is read from settings at each run: an edit applies to the next run.

## Board

- **Clean** stays a direct icon in the project header with its worktree badge, now a
  `CommandButton` for the effective `clean` command (its icon may be edited; deleted → no button,
  no badge). The badge belongs to the `clean` id only.
- **Every other command** goes in one menu button (lucide `Zap`) in the project header, between
  Clean and New ticket: a shadcn `DropdownMenu` listing `commandsFor` (icon + name), then a
  separator and "Manage commands" → `/settings#commands`. Shown on every mapped project, even with
  no commands besides Clean (the way in).
- Tapping a command: as Clean today — toast ("Started <name>" / "<name> is already open"), then
  navigate to the session's terminal. Errors are toasts.
- Only on mapped projects of this instance; nothing for General, nothing in peer bands.

## Settings → Commands

A `CommandsCard` (id `commands`, for the menu's link), after Projects:

- Rows grouped "All projects", then one group per project (`byProjectName`), each row icon + name;
  a default shows a "Default" tag, an edited one "Edited".
- "Add command" and a row tap open `CommandDialog` (bottom sheet below `sm`, dialog above, like
  `ProjectDialog`): Name, Project (All projects / each mapped project), Prompt (textarea), the AI
  button, Icon (a grid of `COMMAND_ICONS`, the picked one ringed), Model/Effort
  (`LaunchOptions`; a new command starts from the new-session sheet's defaults,
  `statusDefaults["In Progress"]`). Footer: Delete (existing), Save.
- Default commands: Delete adds the id to `removed`; an edited one also offers "Reset to default"
  (drops the stored copy). Under the list, a line "Removed defaults: Clean — Restore" while any is
  removed.
- Writes PUT the whole `commands` key; no write before settings have loaded.

## AI help

- `POST /api/commands/assist` `{ text, project? }` → `{ name, prompt, icon }`.
- Agent SDK `query()` as the create-ticket task runs it: `settingSources: []`, `tools: []`, the
  scrubbed env (`agentEnv`), sonnet, one turn, the project name in the message when given. A fixed
  system prompt (`ASSIST_PROMPT`, shared, not a setting): turn the text into a clear instruction
  for a Claude Code session working in the project's repository, keep the user's intent and
  constraints, write it in English (as every prompt Mojito sends), say when to stop and ask the
  human before anything destructive; propose a short name and pick one icon from the listed
  `COMMAND_ICONS`; answer JSON only.
- The answer is parsed with zod; an icon outside the list falls back to the form's current one; a
  parse failure or a 60 s timeout is a 502 `{error}`. Not a stored task: it is synchronous and
  stateless, and the form shows a spinner on the button.
- Web: the button (lucide `Sparkles`, "Write with AI") is disabled with an empty prompt; the
  result replaces name (only if the name field is empty or the dialog is new), prompt and icon,
  and an "Undo" next to the button restores the three previous values until the next edit or
  save.

## Import from another instance

- `GET /api/commands` → `{ commands: Command[] }`, the effective list — added to the relay's
  allowlist (`GET ["commands"]`), so `GET /api/peers/<peer>/commands` reads a peer's.
- In the Commands card, with online peers: "Import from <peer>" (one per online peer) opens a list
  of the peer's commands with checkboxes. A command bound to a project this instance does not map
  is shown disabled ("<project> is not mapped here"). Import merges into the local stored
  setting (`importCommands`, shared, pure): a local command with the same id, else the same name
  (case-insensitive), is replaced **keeping the local id** — its live session stays its session,
  and a local default matched by name becomes an edited copy of that default; no match → added
  (a peer's custom id is kept, a default id the local version does not ship gets a fresh `cmd-`
  id). An imported default equal to the local shipped one ends up as no stored item; a removed
  default that is imported is un-removed. Custom ids are random, so name is what matches a
  command created separately on two machines.
- A peer on an older Mojito answers 404 through the relay: "<peer> has no commands to import".

## Builder's calls (marked as such)

- The exact icon list (cover git, testing, deps, docs, review, deploy, cleanup, bug, search, …).
- Copy for toasts and the AI system prompt's wording.
- Where the project rename/remove hooks into commands (route or repo).
- Ordering of custom commands: stored order (new at the end); no reordering UI.

## Tests

Shared: `effectiveCommands`, `commandsFor`, `CommandsSettingBody`, the merge used by import.
Server: settings store/drop-equal-default/removed round-trip, the run route (404 for a command not
offered, `alreadyOpen`, id `mj-<slug>-clean`), assist parsing (bad JSON, unknown icon) with a
fake `query`, relay allowlist entry, project rename/remove. Web: the icon table covers
`COMMAND_ICONS`; the import merge and dialog logic live in `src/lib` and are unit-tested.
CLAUDE.md: replace the Clean paragraph's route/launch lines and add a Commands paragraph (server
and web).
