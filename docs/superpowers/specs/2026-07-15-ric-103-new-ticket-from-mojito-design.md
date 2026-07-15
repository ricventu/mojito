# RIC-103 — Create new Linear tickets from the Mojito UI

## Problem

Today Mojito can only *advance* tickets that already exist in Linear (`/lime-next`) and
launch bare `claude` sessions (`/lime-new` exists only as a terminal skill in the `lime`
plugin). There is no way to create a brand-new Linear ticket from the Mojito UI.

RIC-103 asks for a form that lets the user type a free-form description (optionally
scoped to a project). Claude then performs a **mini analysis** of that description to
produce a proper ticket — a concise title and a tidy description — and creates it in
Linear's **Backlog**. This is explicitly *not* brainstorming: brainstorming happens later
in Stage 1 of the lifecycle when the ticket is advanced.

## Goal

- A **+ New ticket** entry point on Mojito's Tickets tab.
- A sheet with a **description textarea** and an optional **project** select.
- Submitting spawns a `claude … /lime-new` session (in the selected project's repo path,
  or `$HOME` when no project is chosen) that analyzes the brief and creates a Backlog
  ticket, associating the selected project.
- `/lime-new` behaves **identically** whether invoked from a bare terminal
  (`/lime-new "<description>"`) or from Mojito: its input is always a free-form
  description, and it always runs the mini analysis. There is no verbatim-title path.

## Non-goals

- No brainstorming, no clarifying-question loop, no scope invention in `lime-new` — it
  cleans up and structures what the user wrote, nothing more.
- No auto-advance into the lifecycle. Creating the ticket is the whole job; the user then
  runs `/lime-next <ID>` to start Stage 1.
- No new LLM machinery inside Mojito. Mojito only spawns the `claude` session; the
  analysis happens inside that session via `lime-new`.

## Cross-repo change — lime first

This spans both repos. Per Mojito's `CLAUDE.md`, the dependency is one-directional
(Mojito depends on lime), so **change lime first, then adapt Mojito**.

### lime side (`/Users/ricventu/code/Lime/lime`)

Adapt `skills/lime-new/SKILL.md`:

1. **Input is always a free-form description/brief.** Remove the "title taken verbatim
   from args" semantics. Whether the brief arrives as the command argument
   (`/lime-new "<description>"`) or from the `LIME_NEW_CONTEXT` file (see below), it is
   treated the same way.

2. **Mini-analysis step.** Before creating the ticket, analyze the brief to derive:
   - a **concise title**, and
   - a **tidy, structured description**,
   both in the **brief's own language** (ticket content is user-facing, not a code
   artifact). This is a light rewrite/cleanup — no brainstorming, no clarifying questions,
   no invented requirements. If the brief is empty/unusable, STOP and ask for content
   (mirrors today's "no title → ask").

3. **`LIME_NEW_CONTEXT` contract (new).** Mirrors `LIME_SESSION_CONTEXT`. When the env var
   `LIME_NEW_CONTEXT` is set and the file exists, `lime-new` reads a small JSON:
   ```json
   { "brief": "<free-form user text>", "project": "<project name>|null" }
   ```
   - `brief` is the input to analyze.
   - `project`, when non-null, is **authoritative** for project resolution — skip the
     natural-language/CLI project parsing and the cwd reverse-lookup for the *project*.
     (Team is still resolved from the project via the map, as today.)
   - When `LIME_NEW_CONTEXT` is unset/missing, fall back to the argument as the brief and
     resolve the project as today (prompt phrase → CLI key → cwd reverse-lookup → unset).

4. **Create directly.** Create the Backlog ticket with the analyzed title + description
   (and the resolved project) with no confirmation prompt, then print the identifier and
   URL and stop — matching `lime-new`'s existing "no confirmation" convention.

5. **Version + cache.** Bump `.claude-plugin/plugin.json` from `0.14.0` to `0.15.0`,
   update the plugin in Claude Code (`/plugin`) so the cache rebuilds, and confirm
   `~/.claude/plugins/cache/lime/lime/0.15.0/` exists. `lime-new` runs from the cache, not
   from source, so this step is required for the new behavior to take effect.

## Mojito side

### Server

- **`src/server/launchContext.ts`** — add `writeNewTicketContext(stateDir, id, ctx)` that
  writes `{ brief, project }` to `<stateDir>/context/<id>.json` with `0600` perms, exactly
  like `writeLaunchContext`. Returns the path.

- **`src/server/launch.ts`** — add:
  - `NewTicketLaunchRequest { brief: string; projectName: string | null; model: string; effort: Effort }`.
  - `buildNewTicketClaudeCommand(settingsPath, contextPath)` →
    `LIME_NEW_CONTEXT='<contextPath>' claude --model '<model>' --effort '<effort>' --settings '<settingsPath>' '/lime-new'`
    (same single-quote escaping helper already used in the file).
  - `launchNewTicketSession(req, deps)` — a variant of `launchCustomSession`:
    - Resolve cwd: `resolvePathForProject(map, projectName)` when a project is given
      (return `{ ok:false, reason:"no-repo" }` if unmapped), else `homedir()`.
    - Generate an id via `customSessionName(slug, genId())` where `slug` is the project
      slug or `"new-ticket"`.
    - Write hook settings (as `launchCustomSession` does) and the `LIME_NEW_CONTEXT` file.
    - `newSession` + `pipePane`.
    - Register a `SessionMeta` with `kind: "custom"`, empty `ticket`/`launchStatus`,
      `title: "New ticket · " + (projectName ?? "home")`, `labels: []`.

- **`src/app/api/sessions/route.ts`** — in `POST`, add a branch:
  `if (body.kind === "new-ticket") → launchNewTicketSession({ brief: body.brief ?? "",
  projectName: body.projectName ?? null, model: body.model ?? "opus",
  effort: body.effort ?? "high" }, deps)`. Return the meta with `201`, or `422` on
  `no-repo`. Reject an empty/whitespace `brief` with `400` (defense in depth; the UI also
  guards it).

### UI

- **`src/components/NewTicketSheet.tsx`** (new) — modeled on `NewSessionSheet`:
  - Project `<select>` including `General (home)` (fetched from `/api/projects`).
  - A **description `<textarea>`** (required; submit disabled while empty/whitespace).
  - Model + effort selects (same options/defaults as `NewSessionSheet`).
  - "Create ticket" button → `POST /api/sessions` with
    `{ kind: "new-ticket", brief, projectName, model, effort }`.
  - On success, call `onLaunched(meta)` with the returned session meta and close.

- **`src/components/TicketList.tsx`** — add a **+ New ticket** button in the header (above
  `FilterBar`, visible even when the ticket list is empty). It opens `NewTicketSheet`.
  `TicketList` already receives `onOpen(session)`; wire the sheet's `onLaunched(meta)` to
  (a) refresh tickets + sessions and (b) `onOpen(meta)` so the new session's terminal opens
  immediately — important because a home-scoped `/lime-new` may need the user to pick a
  team interactively.

### Docs

- **`CLAUDE.md`** — in the "shared contract" section, document `LIME_NEW_CONTEXT`
  (`{ brief, project }`, written by `writeNewTicketContext` in `launchContext.ts`, read by
  `lime-new` to analyze the brief and associate the project) next to the existing
  `LIME_SESSION_CONTEXT` entry.

## Data flow

```
Tickets tab  [+ New ticket]
      │  brief + project (or home) + model/effort
      ▼
POST /api/sessions { kind:"new-ticket", brief, projectName, model, effort }
      ▼
launchNewTicketSession
  ├─ resolve cwd  (project repo path | $HOME)
  ├─ write LIME_NEW_CONTEXT { brief, project }
  ├─ tmux: claude … /lime-new   (LIME_NEW_CONTEXT set)
  └─ register kind:"custom" session  → returned meta
      ▼
UI auto-opens the session terminal
      ▼
/lime-new  (in session): read LIME_NEW_CONTEXT → mini-analysis → save_issue (Backlog, project)
      ▼
prints ID + URL, stops.  User later runs /lime-next <ID>.
```

## Testing (vitest, `tests/server/`)

- `launchContext.test.ts` — extend for `writeNewTicketContext`: correct path, `{ brief,
  project }` JSON contents, `0600` perms.
- `launch.test.ts` — `launchNewTicketSession`:
  - cwd resolves to the project repo path when a project is given; to `$HOME` when null;
    `no-repo` when the project is unmapped.
  - the built command contains `/lime-new` and the `LIME_NEW_CONTEXT=` prefix pointing at
    the written context file.
  - the registered meta has `kind:"custom"`, empty `ticket`, and the `New ticket · …`
    title.
- API branch: a `kind:"new-ticket"` POST reaches `launchNewTicketSession` (mirror the
  existing custom-session route test); empty brief → `400`.
- Gate: `npx tsc --noEmit && npx vitest run` green.

## Rollout order

1. Adapt `lime-new` in the lime repo, bump to `0.15.0`, rebuild the plugin cache, confirm
   the cache version.
2. Implement the Mojito server + UI + docs + tests.
3. Manually verify end-to-end: + New ticket → session spawns in the right cwd → `/lime-new`
   creates a Backlog ticket associated to the project → ID printed.
```
