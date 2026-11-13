# Quick Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configurable per-project/global commands (prompt + icon + model/effort) that open a Claude session in a project, with Clean as a shipped default, AI help in the form and import from a peer.

**Architecture:** Pure logic in `packages/shared/src/commands.ts` (types, defaults, validation, effective list, import merge), stored as the `commands` settings key (only the diff from the defaults). The server runs a command through the existing `launchProjectSession` under `mj-<slug>-<id>`, exposes `GET /api/commands` (relayed to peers) and a one-shot Agent SDK `POST /api/commands/assist`. The web replaces `CleanButton` with a generic `CommandButton` plus a `CommandsMenu`, and adds a Settings `CommandsCard`.

**Tech Stack:** TypeScript, zod 4, Hono 4, `@anthropic-ai/claude-agent-sdk`, React 19, TanStack Query, shadcn/ui (Radix), lucide-react, vitest.

**Spec:** `docs/superpowers/specs/2026-11-13-quick-commands-design.md`

## Global Constraints

- Everything in English (code, copy, comments, prompts); user-facing copy per the spec.
- Only Tailwind utilities + shadcn components; icons are lucide with `size`.
- Pure web logic lives in `apps/web/src/lib` and is unit-tested in node (no jsdom).
- `CLEAN_PROMPT` text moves unchanged (byte-for-byte).
- A default id matches `/^[a-z]+$/` and is never `git`; a custom id is `cmd-` + 6 lowercase hex.
- Name: trimmed, 1-40, unique case-insensitively across the **effective** list. Prompt 1-20000. ≤ 100 items.
- Clean session id stays `mj-<slug>-clean`; the `git` suffix stays the git session's.
- The peer relay gains exactly one entry: `GET ["commands"]`. Nothing writes a peer's settings.
- Never let a test touch real tmux sessions; the tmux integration test may be flaky — re-run alone.
- Run `pnpm install` once in the worktree before Task 1.

## Review Focus

1. **A later default shipping a name a custom command uses** — the custom one wins, the default is hidden, saving still works (Task 1 test `effectiveCommands hides a default shadowed by a custom name`).
2. **A live session under the command's id that is not the command's** (another project's free session via slug collision) — 409 with `sessionId`, never `alreadyOpen` (Task 3 test `refuses a live row that is not this command's`).
3. **A command run for a project it is not offered in** (bound to another project, or a removed default) — 404 (Task 3 tests).
4. **AI answer that is not JSON, or an icon outside the list** — 502 / icon falls back (Task 4 tests).
5. **Import from a peer that runs an older Mojito** (404) or a command bound to an unmapped project — friendly message / disabled row (Task 7 lib tests `importableRows`).

---

### Task 1: Shared commands model

**Files:**
- Create: `packages/shared/src/commands.ts`
- Modify: `packages/shared/src/index.ts` (export it), `packages/shared/src/types.ts` (`Settings.commands`, rename `CleanResult` → `CommandResult`), `packages/shared/src/api.ts` (`SettingsBody.commands`)
- Modify: `apps/server/src/sessions/prompt.ts` (remove `CLEAN_PROMPT`, now in shared), `apps/server/test/sessions/prompt.test.ts` (import from `@mojito/shared`)
- Test: `packages/shared/test/commands.test.ts`

**Interfaces:**
- Produces (all from `@mojito/shared`):
  - `COMMAND_ICONS: readonly string[]` (kebab-case lucide names, 40-50, includes `"brush-cleaning"`, `"zap"`); `type CommandIcon = (typeof COMMAND_ICONS)[number]`
  - `interface Command { id: string; name: string; prompt: string; icon: CommandIcon; project: string | null; model: Model; effort: Effort }`
  - `interface CommandsSetting { items: Command[]; removed: string[] }`; `EMPTY_COMMANDS: CommandsSetting`
  - `CLEAN_PROMPT: string`, `DEFAULT_COMMANDS: readonly Command[]` (Clean: `{id:"clean", name:"Clean", icon:"brush-cleaning", project:null, model:"sonnet", effort:"high", prompt: CLEAN_PROMPT}`)
  - `isDefaultCommandId(id: string): boolean`, `isCustomCommandId(id: string): boolean` (`/^cmd-[0-9a-f]{6}$/`), `newCommandId(random?: () => string): string`
  - `CommandSchema` (zod), `CommandsSettingBody` (zod, see Step 3)
  - `effectiveCommands(s: CommandsSetting): Command[]`
  - `commandsFor(effective: Command[], project: string): Command[]`
  - `normalizeCommands(s: CommandsSetting): CommandsSetting` — drops items equal to their default, drops `removed` ids that are not defaults or that have an item
  - `renameCommandsProject(s, from: string, to: string): CommandsSetting`, `removeCommandsProject(s, project: string): CommandsSetting`
  - `importCommands(local: CommandsSetting, incoming: Command[], random?: () => string): CommandsSetting`
  - `interface CommandResult { session: SessionMeta; alreadyOpen: boolean }` (replaces `CleanResult`)
  - `Settings.commands: CommandsSetting`; `SettingsBody.commands?: CommandsSetting`

- [ ] **Step 1: Write the failing tests** in `packages/shared/test/commands.test.ts`:

```ts
const custom = (over: Partial<Command> = {}): Command => ({
  id: "cmd-1a2b3c", name: "Deps", prompt: "Update the dependencies.", icon: "package",
  project: null, model: "sonnet", effort: "high", ...over,
});
const clean = DEFAULT_COMMANDS[0];

it("effectiveCommands: nothing stored answers the defaults", () =>
  expect(effectiveCommands(EMPTY_COMMANDS)).toEqual([clean]));
it("effectiveCommands: an edited default replaces it in place, customs follow in stored order", () => {
  const edited = { ...clean, model: "opus" as const };
  const b = custom({ id: "cmd-bbbbbb", name: "B" });
  expect(effectiveCommands({ items: [b, edited, custom()], removed: [] })).toEqual([edited, b, custom()]);
});
it("effectiveCommands: a removed default is left out", () =>
  expect(effectiveCommands({ items: [], removed: ["clean"] })).toEqual([]));
it("effectiveCommands hides a default shadowed by a custom name", () =>
  expect(effectiveCommands({ items: [custom({ name: "clean" })], removed: [] }).map((c) => c.id)).toEqual(["cmd-1a2b3c"]));
it("commandsFor: global ones and the project's own", () => {
  const web = custom({ id: "cmd-000001", name: "W", project: "Web" });
  const api = custom({ id: "cmd-000002", name: "A", project: "Api" });
  expect(commandsFor([clean, web, api], "Web")).toEqual([clean, web]);
});
it("normalizeCommands drops an item equal to its default and stray removed ids", () =>
  expect(normalizeCommands({ items: [{ ...clean }], removed: ["nope", "clean"] })).toEqual({ items: [], removed: ["clean"] }));
it("normalizeCommands: an edited default un-removes it", () =>
  expect(normalizeCommands({ items: [{ ...clean, name: "Sweep" }], removed: ["clean"] }).removed).toEqual([]));
it("CommandsSettingBody refuses an id outside both namespaces, a reserved/unknown default id, a duplicate effective name, an unknown icon", () => {
  const bad = (items: Command[]) => CommandsSettingBody.safeParse({ items, removed: [] }).success;
  expect(bad([custom({ id: "deps" })])).toBe(false);       // looks like a default, ships none
  expect(bad([custom({ id: "cmd-XYZ" })])).toBe(false);
  expect(bad([custom({ name: " Clean " })])).toBe(false);   // collides with the effective default
  expect(bad([custom({ icon: "skull" as CommandIcon })])).toBe(false);
  expect(bad([custom()])).toBe(true);
  expect(CommandsSettingBody.safeParse({ items: [custom({ name: "Clean" })], removed: ["clean"] }).success).toBe(true);
});
it("newCommandId has the custom shape", () => expect(isCustomCommandId(newCommandId())).toBe(true));
it("renameCommandsProject / removeCommandsProject", () => {
  const web = custom({ project: "Web" });
  const cleanWeb = { ...clean, project: "Web" };
  expect(renameCommandsProject({ items: [web, cleanWeb], removed: [] }, "Web", "Site").items.map((c) => c.project)).toEqual(["Site", "Site"]);
  expect(removeCommandsProject({ items: [web, cleanWeb, custom({ id: "cmd-999999", name: "G" })], removed: [] }, "Web"))
    .toEqual({ items: [custom({ id: "cmd-999999", name: "G" })], removed: [] });
});
describe("importCommands", () => {
  it("same id replaces", () => {
    const local = { items: [custom()], removed: [] };
    expect(importCommands(local, [custom({ prompt: "New." })]).items).toEqual([custom({ prompt: "New." })]);
  });
  it("same name keeps the local id; a local default matched by name becomes its edited copy", () => {
    const local = { items: [custom()], removed: [] };
    expect(importCommands(local, [custom({ id: "cmd-ffffff", name: "deps", prompt: "X" })]).items)
      .toEqual([custom({ name: "deps", prompt: "X" })]);
    expect(importCommands(EMPTY_COMMANDS, [custom({ id: "cmd-ffffff", name: "Clean", prompt: "X" })]).items)
      .toEqual([{ ...custom({ name: "Clean", prompt: "X" }), id: "clean" }]);
  });
  it("no match adds; an unknown default id gets a fresh cmd- id; equal default stores nothing; removed default is un-removed", () => {
    expect(importCommands(EMPTY_COMMANDS, [custom()]).items).toEqual([custom()]);
    const fresh = importCommands(EMPTY_COMMANDS, [custom({ id: "deploy", name: "Deploy" })], () => "abcdef");
    expect(fresh.items[0].id).toBe("cmd-abcdef");
    expect(importCommands({ items: [], removed: ["clean"] }, [clean])).toEqual(EMPTY_COMMANDS);
  });
});
```

Also update `prompt.test.ts` to import `CLEAN_PROMPT` from `@mojito/shared` (its assertions unchanged).

- [ ] **Step 2: Run** `pnpm --filter @mojito/shared test` — expect FAIL (module missing).

- [ ] **Step 3: Implement `commands.ts`**. `CommandSchema`: `id` string, `name` `z.string().trim().min(1).max(40)`, `prompt` `z.string().min(1).max(20000)`, `icon` `z.enum(COMMAND_ICONS)`, `project` `z.string().min(1).nullable()`, `model`/`effort` enums. `CommandsSettingBody`: `{ items: CommandSchema[] ≤100, removed: string[] ≤50 }` with a `superRefine` that rejects an item id neither custom-shaped nor a `DEFAULT_COMMANDS` id, duplicate item ids, and duplicate names (case-insensitive, trimmed) in `effectiveCommands(value)`. The shadowing rule in `effectiveCommands`: a default is skipped when any custom item (`isCustomCommandId`) has its name case-insensitively. `importCommands` applies the spec's rules per incoming command, then returns `normalizeCommands(result)`. Move `CLEAN_PROMPT` verbatim from `apps/server/src/sessions/prompt.ts` (keep its doc comment). Rename `CleanResult` → `CommandResult` in `types.ts` and every user (`grep -rn CleanResult apps packages`). Add `commands: CommandsSetting` to `Settings` and `commands: CommandsSettingBody.optional()` to `SettingsBody`.

- [ ] **Step 4: Run** `pnpm --filter @mojito/shared test && pnpm --filter @mojito/server test -- prompt` — expect PASS. (Server/web typecheck may fail on `Settings.commands` until Task 2/5; that is fine here — fix only `CleanResult` renames now.)

- [ ] **Step 5: Commit** `feat(shared): commands model with Clean as a default (RIC-581)`.

---

### Task 2: Stored setting

**Files:**
- Modify: `apps/server/src/db/settings.ts`
- Test: `apps/server/test/http/settings.test.ts`

**Interfaces:**
- Consumes: `CommandsSettingBody`, `normalizeCommands`, `EMPTY_COMMANDS` (Task 1).
- Produces: `SettingsRepo.get().commands` (stored form); `SettingsRepo.set({commands})` stores `normalizeCommands(...)`; `SettingsRepo.setCommands(s: CommandsSetting): void` (used by Task 3's project hooks).

- [ ] **Step 1: Write failing tests** in `settings.test.ts`: `GET /api/settings` answers `commands: {items: [], removed: []}` on a fresh db; a `PUT {commands: {items: [Clean unchanged], removed: ["clean","x"]}}` answers `commands: {items: [], removed: ["clean"]}`; a `PUT` with a duplicate effective name answers 400; a corrupt stored `commands` row (written straight to the `settings` table) serves `EMPTY_COMMANDS` and `console.warn` is called once across two GETs.

- [ ] **Step 2: Run** `pnpm --filter @mojito/server test -- settings` — FAIL.

- [ ] **Step 3: Implement** in `SettingsRepo`: `defaultSettings()` gains `commands: EMPTY_COMMANDS`; `get()` parses the `commands` row with `CommandsSettingBody.safeParse`, warns once (`warnedCommands`, same wording pattern as favourites); `set()` writes `normalizeCommands(s.commands)`; `setCommands` = `set({commands})`.

- [ ] **Step 4: Run** the same — PASS.

- [ ] **Step 5: Commit** `feat(server): store commands as a settings key (RIC-581)`.

---

### Task 3: Running a command, listing, relay, project hooks

**Files:**
- Modify: `apps/server/src/sessions/launch.ts` (`launchCommand`, ownership check, remove `launchClean`)
- Create: `apps/server/src/http/routes/commands.ts` (`GET /commands`, `POST /projects/:name/commands/:id`)
- Modify: `apps/server/src/http/routes/git.ts` (remove the `/clean` route), `apps/server/src/http/app.ts` (mount `commandRoutes`), `apps/server/src/http/routes/projects.ts` (rename/remove hooks), `apps/server/src/peers/relay.ts` (allowlist)
- Test: `apps/server/test/http/commands.test.ts` (new; move the clean cases out of `test/http/git.test.ts`), `apps/server/test/sessions/launch.test.ts`, `apps/server/test/http/projects.test.ts`, `apps/server/test/peers/relay.test.ts`

**Interfaces:**
- Consumes: `effectiveCommands`, `commandsFor`, `renameCommandsProject`, `removeCommandsProject`, `CommandResult` (Task 1); `SettingsRepo.setCommands` (Task 2).
- Produces: `launchCommand(project: string, command: Command, deps: LaunchDeps): Promise<ProjectSessionResult>`; `ProjectSessionResult` failure gains `sessionId?: string`; `commandRoutes(deps: AppDeps): Hono`.

- [ ] **Step 1: Write failing tests.**
  - `commands.test.ts`: `POST /api/projects/Web/commands/clean` → 200 `{alreadyOpen:false, session:{id:"mj-web-clean", project:"Web"}}` and `newSession` called with `("mj-web-clean", "/home/me/repo/web", stringContaining("fetch --prune"))` (the old clean case, ported); a live `mj-web-clean` row of project Web → `{alreadyOpen:true, session: live}`; unknown project → 404; a command bound to `Api` asked on `Web` → 404; `clean` after `removed:["clean"]` → 404; an edited Clean with `model:"opus"` launches with opus; **`refuses a live row that is not this command's`**: a live row `mj-web-clean` with `project: "Web-clean"` (or a `ticket`) → 409 `{error, sessionId:"mj-web-clean"}`; `GET /api/commands` → `{commands: [Clean]}`.
  - `git.test.ts`: `POST /api/projects/Web/clean` → 404 (route gone).
  - `projects.test.ts`: renaming `Web`→`Site` moves a bound command's `project`; deleting `Web` drops its bound custom command and an edited Clean bound to it; both emit `settings.updated`.
  - `relay.test.ts`: `matchRelay("GET", ["commands"])` → `"/api/commands"`; `matchRelay("PUT", ["settings"])` stays `null`.

- [ ] **Step 2: Run** `pnpm --filter @mojito/server test -- commands git projects relay launch` — FAIL.

- [ ] **Step 3: Implement.** In `launchProjectSession`, an existing live row whose tmux is alive is `alreadyOpen` only when `existing.project === req.project && existing.ticket === null && existing.kind === "claude"`; otherwise `{ok:false, status:409, error:\`another session holds ${id}\`, sessionId: id}`. `launchCommand` = `launchProjectSession({project, suffix: command.id, model: command.model, effort: command.effort, prompt: command.prompt}, deps)`. The run route: 404 `project not found` (unmapped), path check as `gitRoutes.checkout` does (400), find `id` in `commandsFor(effectiveCommands(deps.settings.get().commands), name)` else 404 `command not found: <id>`, then launch; answer `CommandResult` or `{error, sessionId?}` with its status. Project routes: after a rename `deps.settings.setCommands(renameCommandsProject(...))`, after a delete `removeCommandsProject(...)`, emitting `settings.updated` only when the setting changed. Relay: add `{ method: "GET", pattern: ["commands"] }`.

- [ ] **Step 4: Run** the same — PASS. Then `pnpm --filter @mojito/server typecheck`.

- [ ] **Step 5: Commit** `feat(server): run a project's commands; Clean becomes one (RIC-581)`.

---

### Task 4: AI assist endpoint

**Files:**
- Create: `apps/server/src/commands/assist.ts`
- Modify: `packages/shared/src/commands.ts` (`ASSIST_PROMPT`, `AssistBody`, `AssistAnswer`), `apps/server/src/http/routes/commands.ts` (`POST /commands/assist`), `apps/server/src/http/app.ts` (`AppDeps.assist?`), `apps/server/src/main.ts` (wire the real one), `apps/server/src/tasks/runner.ts` (export `agentEnv`)
- Test: `apps/server/test/commands/assist.test.ts`, `apps/server/test/http/commands.test.ts`

**Interfaces:**
- Produces: `AssistBody = z.object({ text: z.string().trim().min(1).max(20000), project: z.string().optional(), icon: z.enum(COMMAND_ICONS).optional() })`; `interface AssistAnswer { name: string; prompt: string; icon: CommandIcon }`; `ASSIST_PROMPT: string`; `assistCommand(body: AssistBody, deps: { query: QueryFn; timeoutMs?: number }): Promise<AssistAnswer>` throwing `AssistError` (message for the 502); `AppDeps.assist?: (body: AssistBody) => Promise<AssistAnswer>`.

- [ ] **Step 1: Write failing tests** with a fake `query` yielding a `result` message: valid JSON `{"name":"Deps","prompt":"Update…","icon":"package"}` → that answer; JSON in a ```json fence → parsed; icon `"skull"` → `body.icon ?? "zap"`; name trimmed and cut to 40; not JSON → `AssistError`; a `query` that never ends with `timeoutMs: 10` → `AssistError` mentioning the timeout. The options passed to `query` include `settingSources: []`, `tools: []`, `model: "sonnet"`, `maxTurns: 1`, `systemPrompt: ASSIST_PROMPT`, and the message contains the project name and the list of `COMMAND_ICONS`. Route: `POST /api/commands/assist` with an injected `deps.assist` → 200 answer; empty text → 400; `AssistError` → 502 `{error}`.

- [ ] **Step 2: Run** `pnpm --filter @mojito/server test -- assist commands` — FAIL.

- [ ] **Step 3: Implement.** `ASSIST_PROMPT` (one line per paragraph) says what the spec's AI help section says: rewrite into a clear English instruction for a Claude Code session working in the project's repository, keep intent and constraints, stop and ask the human before anything destructive, propose a short name (≤ 40) and one icon from the given list, answer only `{"name","prompt","icon"}` JSON. Timeout default 60 000 ms via `AbortController` passed as `options.abortController`. The route uses `deps.assist ?? ((b) => assistCommand(b, { query }))`.

- [ ] **Step 4: Run** the same — PASS.

- [ ] **Step 5: Commit** `feat(server): AI help for writing a command (RIC-581)`.

---

### Task 5: Board — Clean as a command, commands menu

**Files:**
- Add: `apps/web/src/components/ui/dropdown-menu.tsx` (`pnpm dlx shadcn@latest add dropdown-menu` in `apps/web`)
- Create: `apps/web/src/lib/commandIcons.tsx` (`COMMAND_ICON_COMPONENTS: Record<CommandIcon, LucideIcon>`, `CommandIconView({icon, size})`), `apps/web/src/components/board/CommandButton.tsx`, `apps/web/src/components/board/CommandsMenu.tsx`, `apps/web/src/hooks/useRunCommand.ts`
- Rename: `apps/web/src/lib/clean.ts` → `apps/web/src/lib/commands.ts` (keep `worktreeBadge`, `cleanLabel`; replace `cleanMessage` with `commandMessage(name, alreadyOpen)`; add `menuCommands(effective, project)` = `commandsFor` minus `clean`, `boardClean(effective, project)` = the `clean` command if offered)
- Delete: `apps/web/src/components/board/CleanButton.tsx`
- Modify: `apps/web/src/components/board/ProjectSection.tsx`
- Test: `apps/web/test/lib/commands.test.ts` (from `clean.test.ts`), `apps/web/test/lib/commandIcons.test.ts`

**Interfaces:**
- Consumes: `effectiveCommands`, `commandsFor`, `CommandResult`, `COMMAND_ICONS` (Task 1); `POST /api/projects/:name/commands/:id` (Task 3); `useSettings()`.
- Produces: `useRunCommand(project: string): UseMutationResult<CommandResult, Error, Command>` (toast `commandMessage`, invalidate `qk.sessions`, navigate to `/session/<id>`; on error toast `"<name> failed: <message>"`); `CommandIconView`.

- [ ] **Step 1: Write failing tests:** `commandIcons.test.ts` — every `COMMAND_ICONS` name has a component; `commands.test.ts` — the ported `worktreeBadge`/`cleanLabel` cases; `commandMessage("Clean", true)` = `"Clean is already open"`, `commandMessage("Deps", false)` = `"Started Deps"`; `menuCommands` excludes `clean` and other projects' commands; `boardClean` is `undefined` when Clean is removed.

- [ ] **Step 2: Run** `pnpm --filter @mojito/web test -- commands commandIcons` — FAIL.

- [ ] **Step 3: Implement.** `CommandButton` is `CleanButton` generalised: props `{project, command}`, the worktree badge/label only when `command.id === "clean"`, icon from `CommandIconView`. `CommandsMenu`: a ghost `icon-sm` `Zap` trigger (`aria-label="Commands for <project>"`), items = `menuCommands` (icon + name, `onSelect` runs it), separator, "Manage commands" `<Link to="/settings#commands">`. `ProjectSection` renders `boardClean` → `CommandButton`, then `CommandsMenu`, where `CleanButton` was.

- [ ] **Step 4: Run** `pnpm --filter @mojito/web test && pnpm --filter @mojito/web typecheck` — PASS.

- [ ] **Step 5: Commit** `feat(web): Clean as a command and a commands menu on the project header (RIC-581)`.

---

### Task 6: Settings — Commands card and dialog with AI help

**Files:**
- Create: `apps/web/src/lib/commandForm.ts`, `apps/web/src/components/settings/CommandsCard.tsx`, `apps/web/src/components/settings/CommandDialog.tsx`, `apps/web/src/components/settings/IconGrid.tsx`
- Modify: `apps/web/src/components/settings/SettingsPage.tsx` (card after `ProjectsCard`, wrapper `id="commands"`, scroll into view when `location.hash === "#commands"`)
- Test: `apps/web/test/lib/commandForm.test.ts`

**Interfaces:**
- Consumes: Task 1 functions, `POST /api/commands/assist` (Task 4), `LaunchOptions`, `useProjects`, `useSettings`.
- Produces (in `lib/commandForm.ts`):
  - `type CommandDraft = Omit<Command, "id"> & { id: string | null }`
  - `newDraft(defaults: {model: Model; effort: Effort}, project?: string): CommandDraft` (icon `"zap"`, `project ?? null`)
  - `applyAssist(draft: CommandDraft, answer: AssistAnswer): CommandDraft` (name replaced only when `draft.name.trim() === ""` or `draft.id === null`)
  - `saveDraft(s: CommandsSetting, draft: CommandDraft, random?: () => string): CommandsSetting` (new → `newCommandId`, appended; existing → replaced in place, a default stored as its edited copy; normalized)
  - `deleteCommand(s, id): CommandsSetting` (default → `removed`; custom → dropped), `resetDefault(s, id)`, `restoreDefault(s, id)`
  - `commandGroups(effective: Command[]): { project: string | null; commands: Command[] }[]` ("All projects" first, then `byProjectName`)
  - `commandTag(s: CommandsSetting, id: string): "Default" | "Edited" | null`

- [ ] **Step 1: Write failing tests** for each function: `saveDraft` of an unchanged Clean stores nothing; of an edited Clean stores it under `"clean"`; of a new draft with `random = () => "abcdef"` appends `cmd-abcdef`; `deleteCommand(…, "clean")` → `removed: ["clean"]`; `restoreDefault` empties `removed`; `resetDefault` drops the stored copy; `applyAssist` keeps a typed name on an existing command and fills it on a new one; `commandGroups` order; `commandTag`.

- [ ] **Step 2: Run** `pnpm --filter @mojito/web test -- commandForm` — FAIL.

- [ ] **Step 3: Implement** the lib, then the components. `CommandDialog` uses `Sheet side="bottom"` with `SHEET_CONTENT_CLASS` (as the board's modals); fields per the spec; "Write with AI" (`Sparkles`, spinner while pending, disabled on an empty prompt) posts `{text: prompt, project, icon}` and keeps the pre-assist draft for one "Undo" (cleared by the next field edit or a save); errors inline. Save PUTs `{commands: saveDraft(...)}`; Delete / Reset to default likewise; nothing writes before settings load; success invalidates `qk.settings`. `CommandsCard` lists `commandGroups` with `CommandIconView`, `commandTag` badges, "Add command", and "Removed defaults: <name> — Restore" while `removed` is non-empty.

- [ ] **Step 4: Run** `pnpm --filter @mojito/web test && pnpm --filter @mojito/web typecheck` — PASS.

- [ ] **Step 5: Commit** `feat(web): manage commands in Settings with AI help (RIC-581)`.

---

### Task 7: Import from a peer

**Files:**
- Create: `apps/web/src/components/settings/ImportCommandsDialog.tsx`
- Modify: `apps/web/src/lib/commandForm.ts` (`importableRows`), `apps/web/src/components/settings/CommandsCard.tsx` (one "Import from <peer>" per online peer)
- Test: `apps/web/test/lib/commandForm.test.ts`

**Interfaces:**
- Consumes: `importCommands` (Task 1), `GET /api/peers/<peer>/commands` via `hostApi(peer, "/api/commands")`, `usePeers`, `useProjects`.
- Produces: `importableRows(incoming: Command[], mapped: string[]): { command: Command; disabledReason: string | null }[]` (`"<project> is not mapped here"`); `importErrorMessage(peer: string, err: unknown): string` (`ApiError` 404 → `"<peer> has no commands to import"`, else the message).

- [ ] **Step 1: Write failing tests** for `importableRows` (global → enabled; bound to unmapped → disabled with the reason) and `importErrorMessage` (404 and other).

- [ ] **Step 2: Run** `pnpm --filter @mojito/web test -- commandForm` — FAIL.

- [ ] **Step 3: Implement** the lib functions and the dialog: fetch on open (`gcTime: 0`, no refetch), checkboxes (enabled rows checked by default), "Import N" PUTs `{commands: importCommands(current, picked)}`, toast `"Imported N commands from <peer>"`.

- [ ] **Step 4: Run** `pnpm test && pnpm typecheck` at the repo root — PASS.

- [ ] **Step 5: Commit** `feat(web): import commands from another instance (RIC-581)`.

---

### Task 8: Docs and full verification

**Files:**
- Modify: `CLAUDE.md` — replace the server **Clean** paragraph's route/`launchClean`/`CLEAN_PROMPT` lines with a **Commands** paragraph (setting shape and id namespaces, `effectiveCommands` shadowing, run route + ownership 409, `GET /api/commands` on the relay table, assist endpoint, project rename/remove); update the web "Project header" paragraph (`CommandButton`, `CommandsMenu`, `lib/commands.ts`), the Layout's shared list (`CommandResult` instead of `CleanResult`, commands types), and add Settings → Commands.

- [ ] **Step 1:** Edit `CLAUDE.md` as above.
- [ ] **Step 2: Run** `pnpm test && pnpm typecheck && pnpm build` — all PASS.
- [ ] **Step 3:** `pnpm dev`, open the board: Clean icon with badge works; the menu lists a new command and runs it; a second tap says "already open"; Settings → Commands add/edit/delete/restore Clean; "Write with AI" fills the form.
- [ ] **Step 4: Commit** `docs: commands in CLAUDE.md (RIC-581)`.
