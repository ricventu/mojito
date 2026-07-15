# Mojito

Mojito is a Next.js + TypeScript app (GUI + local server) that launches and monitors
`lime` ticket-lifecycle sessions. It spawns `claude … /lime-next <TICKET>` processes in
detached tmux sessions, tracks their state, and lets the user advance a Linear ticket
through its lifecycle from a web UI.

## Relationship to `lime` (separate repo — read this before cross-repo work)

`lime` is a **separate** Claude Code plugin, not part of this repo. Source lives at
`/Users/ricventu/code/Lime/lime` (skill `skills/lime-next/SKILL.md`). The two are kept in
separate repos on purpose: `lime` has standalone value (`/lime-next` runs in a bare
terminal without Mojito), so it ships as its own installable plugin.

The dependency is **one-directional: Mojito depends on lime, never the reverse.** lime
degrades gracefully without Mojito (bare-terminal mode). So for a cross-cutting change,
**change lime first, then adapt Mojito to it.**

### The shared contract (what must stay in sync)

1. **Launch context** — Mojito writes a `LIME_SESSION_CONTEXT` file
   (`src/server/launchContext.ts`, called from `src/server/launch.ts`) holding
   `{ identifier, statusName, title, project, labels }`. lime reads it to skip `get_issue`
   on stages 2–5. If you change these fields, update lime's context-consumption step in
   `skills/lime-next/SKILL.md` to match.

1b. **New-ticket context** — for the "New ticket" UI flow, Mojito writes a
   `LIME_NEW_CONTEXT` file (`writeNewTicketContext` in `src/server/launchContext.ts`,
   called from `launchNewTicketSession` in `src/server/launch.ts`) holding
   `{ brief, project }`. The spawned `claude … /lime-new` session reads it to analyze the
   brief and associate the project. If you change these fields, update lime's
   `skills/lime-new/SKILL.md` context-read step to match.

2. **Status / stage model** — the ticket lifecycle is:
   `Backlog/Todo → To Code → To Review → To QA → To Merge → Done`.
   - lime side: the dispatch table + stage bodies in `skills/lime-next/SKILL.md` (and the
     matrix in lime's `README.md`).
   - Mojito side: `STAGE_OF` in `src/server/autoAdvance.ts` (maps each status to its
     stage; `stageAdvanced` decides auto-advance), and `tmuxName()` in
     `src/server/sessionKey.ts` (session names embed the status slug).
   These two must agree on the exact status names. A mismatch silently breaks
   auto-advance and session naming.

### Working on a task that spans both repos

When a Mojito task implies a lime change (e.g. changing the status model):

1. Make the lime change in `/Users/ricventu/code/Lime/lime` on its own branch:
   edit `skills/lime-next/SKILL.md` + `README.md`, keep them internally consistent, and
   bump the version in `.claude-plugin/plugin.json`.
2. **Rebuild the plugin cache.** lime runs from
   `~/.claude/plugins/cache/lime/lime/<version>/`, NOT from source. Editing source has no
   runtime effect until the plugin is updated in Claude Code (via `/plugin`) so the new
   version lands in the cache. Confirm `ls ~/.claude/plugins/cache/lime/lime/` shows the
   new version.
3. Adapt Mojito to the new lime version (e.g. update `STAGE_OF`), with tests.
4. If the change touches Linear workflow states, create/rename them in Linear and migrate
   existing tickets — Mojito and lime both read the live Linear status.

### Repo resolution

lime resolves a ticket's repo from `~/.claude/lime-projects.json` (project name → repo
path). Mojito is registered there as `Mojito → /Users/ricventu/code/Lime/mojito`, lime as
`Lime → /Users/ricventu/code/Lime/lime`.

## Tests

`npx tsc --noEmit && npx vitest run` — server logic lives under `src/server/`, tests under
`tests/server/`. The tmux integration test is skipped when `tmux` is unavailable.
