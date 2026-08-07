# Mojito-native lifecycle (remove lime) — design

2026-08-07

Single-repo: everything here changes Mojito. The lime plugin is retired, its repo
archived, and the cross-repo contract in `CLAUDE.md` deleted. This supersedes the
lime-side parts (1, 3, 4 and the `/lime-express` half of 5) of
`2026-08-04-lime-flow-fewer-steps-design.md`; part 2 of that doc (the verdict launches
the next session) is absorbed here.

## Problem

The lifecycle is split across two repos and three layers: Mojito spawns
`claude '/lime-<stage> TICKET'`, the lime plugin cache carries ~60 KB of stage prose,
and each spawned session loads the Linear MCP to make 2–3 write calls
(`list_issue_statuses`, `save_issue`, `save_comment`). Keeping the two repos in sync is
a documented, error-prone contract (launch context fields, status names, stage-skill
map, plugin-cache rebuilds). The per-ticket cost is 3 sessions and ~7 interactions, and
the measured effect is that work bypasses the pipeline (18 of 20 sub-150-line branches
had no ticket).

lime's standalone value — running `/lime-next` in a bare terminal without Mojito — is no
longer used. With that gone, the one-directional dependency that justified the separate
plugin no longer buys anything.

What is *not* the problem: spec/plan duplication into Linear. No lime stage posts spec
or plan content to Linear — comments carry only file paths and git-derivable facts. The
noise is the comment-per-transition itself, and Mojito's `DocsView` already renders the
local files.

## Requirements

1. One repo owns the lifecycle: prompts, Linear writes, and the state machine all live
   in Mojito.
2. Spawned sessions never touch Linear — no MCP, no reads, no writes.
3. Linear is a backlog, not a work log: Mojito writes only issue creation, status
   transitions, and assignee. No comments, no uploaded specs.
4. One work session per ticket, then the human QA gate in the Mojito UI.
5. A QA rejection's reason must reach the next session (today it dies as an unread
   Linear comment).
6. Trivial merges cost zero tokens.

## Status model

`Todo → In Progress → To QA → Done` (plus Canceled/Duplicate as terminals). Reject in
QA returns the ticket to In Progress. One-time workspace migration: create
"In Progress", move open started tickets onto it (e.g. RIC-134 from To Code), delete
To Code / To Review / To Merge. `STAGE_OF` in `src/server/autoAdvance.ts` shrinks to the
four states; `GATE_STATES` becomes `["To QA"]`.

## Work session

`src/server/stageCommand.ts` is replaced by a prompt builder (`src/server/prompts.ts`
with markdown templates under `src/server/prompts/`), following the existing
`buildCustomClaudeCommand` pattern in `src/server/launch.ts`: Mojito passes a full
prompt string, no plugin slash command.

The launch context file survives, renamed `MOJITO_SESSION_CONTEXT`, and now also carries
the ticket **description**, which Mojito fetches over its existing GraphQL client
(`src/server/linear.ts`). That removes the session's last reason to load the Linear MCP.

One session covers the whole work phase: worktree + branch, design (superpowers
brainstorming or systematic-debugging, with open design questions as a blocking gate —
the RIC-139 behavior carries over because the session is interactive in Mojito's
terminal), spec and plan committed as local files, implementation, and a final
self-review via `superpowers:requesting-code-review`.

**Decision, recorded deliberately:** the fewer-steps doc measured stage collapse as a
net token loss (implementation turns re-read the design conversation in the cached
prefix; ~+2.5M–4.3M input-equivalent versus ~50–80k saved from dropping a session
boundary). The single session is chosen anyway, trading tokens for fewer moving parts
(no chaining machinery, no mid-flight handoff). If the cost proves unacceptable in
practice, the fallback is two auto-chained sessions under the same In Progress status —
the outcome-file channel below already supports it.

## Outcome channel (replaces status polling)

At the end of the work phase the session writes
`MOJITO_STATE_DIR/results/<sessionId>.json`:

```json
{ "outcome": "ready-for-qa" | "blocked", "notes": "<short free text>" }
```

The Stop hook handler reads it and Mojito moves the status itself
(`setIssueStatus` → To QA on `ready-for-qa`; on `blocked` the ticket stays In Progress
and the session parks as needs-input). `getIssueStatus` leaves the hook path entirely —
today's poll-Linear-to-guess-what-the-session-did loop is gone, and with it the
session-side status writes it depended on.

## QA gate and merge

The gate stays in the UI (`QaVerdictButtons` in `src/components/LaunchSheet.tsx`).

- **Approve** → new `src/server/merge.ts`: fetch, attempt rebase/fast-forward
  server-side; when clean, merge locally or open an MR via `gh`/`glab` — zero tokens.
  On conflict, launch a session with a targeted conflict-resolution prompt built from
  the same template system.
- **Reject** → the reason is written into the next session's context file, and the
  launch happens immediately (absorbing RIC-172). Nothing is posted to Linear.

## New ticket

`/lime-new` disappears. The New Ticket form creates the issue directly through a new
`createIssue` mutation in `src/server/linear.ts` (`uploadImage` already exists for the
attached images). The form gains a title field; the brief becomes the description.
`writeNewTicketContext` and the new-ticket session kind are removed.

## Removals and renames

- Uninstall the lime plugin; archive the lime repo; cancel RIC-170, RIC-171, RIC-173.
- Rewrite `CLAUDE.md` (drop the entire cross-repo section) and `README.md`.
- `src/server/limeProjects.ts` → `projects.ts`; the map moves to
  `~/.config/mojito/projects.json`, with read-fallback from
  `~/.claude/lime-projects.json` for one release.
- `SessionMeta.kind: "lime"` → `"ticket"`; sidecar loader migrates the legacy value on
  read (extending the existing legacy default in `src/server/sidecar.ts`).
- `LIME_SESSION_CONTEXT` / `LIME_NEW_CONTEXT` env names go away.
- `launchRebaseSession` and the To QA "Rebase onto default branch" button are removed:
  the server-side rebase in `merge.ts` covers it at approve time, and its conflict path
  launches the same resolution session.

## Testing

- Adapt the ~16 existing server/lib test files that assert on `/lime-*` commands,
  `LIME_SESSION_CONTEXT`, or `kind: "lime"`.
- New unit tests: prompt builder (template interpolation, per-status selection), outcome
  reader (valid, missing, malformed file), sidecar kind migration.
- `merge.ts` integration tests against fixture git repos (same approach as the existing
  worktree tests): clean ff, clean rebase, conflict → session launch decision.

## Rollout

1. Land the Mojito changes behind the existing state machine (new statuses tolerated by
   `KNOWN_STATUSES` before the workspace migration).
2. Migrate the Linear workspace states; move open tickets.
3. Uninstall the plugin, archive the repo, cancel the superseded tickets.

## Out of scope

- Multi-stage lanes for large tickets (launch a second session from the ticket by hand;
  the UI already allows it).
- Uploading specs/plans to Linear in any form.
- Any change to superpowers.
- Replacing Linear as the backlog.
