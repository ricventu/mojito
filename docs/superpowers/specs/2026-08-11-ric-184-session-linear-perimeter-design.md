# RIC-184 — Stop telling the session anything about Linear

> The filename says "perimeter" for historical reasons: the first three designs all built
> one. The shipped answer is that there is no perimeter, and no instruction about Linear at
> all. Read the Decision section before the rest.

## Problem

The work prompt Mojito hands a ticket session said:

> Never use any Linear tool, MCP server, or API in this session — Mojito manages Linear for you.

The intent was to keep Mojito the sole owner of the worked ticket's lifecycle. The effect
was wider: it also forbade **creating** issues, and creation is exactly what a session is
best placed to do. Follow-up work surfaces mid-implementation, when the agent is holding
the file, the line and the evidence. The user was getting draft text in the chat and
re-typing it into Linear by hand.

RIC-179 (11/08/2026) produced four such follow-ups — RIC-180, RIC-181, RIC-182, RIC-183 —
each with evidence already gathered. They exist only because the user explicitly overrode
the ban mid-session. Without that, they would have died in the scrollback.

## Decision

**Delete the ban. Put nothing in its place.**

Neither prompt says anything about how the session may use Linear — no prohibition, no
permission. Mojito's relationship to the session is two files and nothing more:

- the **context file**, carrying the ticket data Mojito already read, so the session spends
  no tokens fetching what Mojito has in hand;
- the **result file**, carrying the outcome back.

With no instruction in either direction, the session behaves like one the user started by
hand: if filing a follow-up is the right move, it proposes one and the user confirms
through the normal flow. That is the desired behaviour, and it needs no prompt support.

### Three designs were tried and rejected before this one

Recorded because each looked reasonable at the time, and the next reader will be tempted by
at least one of them:

1. **Narrow the ban to the worked ticket** (the ticket's own option B). Forbade status,
   assignee, comments and attachments on `{{TICKET}}`; permitted reads and creation.
   Rejected: still an instruction about Linear, and it made a spawned session behave
   differently from a hand-started one.
2. **Narrow it further, after a code review.** The review argued that naming `{{TICKET}}`
   as the only forbidden object left a permissive reading for sibling issues, so three
   clauses were added: every other issue read-only, creation as "your only Linear write",
   no sub-issue filing. Rejected: none of it was in the ticket, and each clause bought back
   more of the hesitation RIC-184 exists to remove.
3. **Drop the prohibition, keep an explicit permission.** The paragraph told the session
   Mojito moves the ticket from the result file and that it could file follow-ups "without
   asking the user for permission". Rejected, and this one was actively worse than the ban:
   it had the session opening tickets unilaterally. A normal session proposes and waits.

The through-line: every attempt to *word* the boundary produced a session that behaved
unlike a normal one, in one direction or the other. Saying nothing is the only version that
doesn't.

### Why no prohibition is needed

`setIssueStatus` (`src/server/linear.ts:254-283`) resolves the target workflow state by name
and writes it unconditionally — it never reads the ticket's current status and never
branches on it. The Stop hook's `moveToQa` is therefore last-write-wins and idempotent
whatever the session did to the ticket meanwhile. The ban protected nothing; it was
tidiness, and it cost real follow-up tickets.

### Feasibility

`src/server/launch.ts:57` spawns `claude --model … --effort … --settings … '<prompt>'`.
No `--strict-mcp-config`, no MCP suppression: the session inherits the user's own Linear
MCP connector and permission rules. The ban was prompt wording alone, so removing it is
prompt wording alone. No credential plumbing, no new Mojito code path.

## Design

A deletion, plus one clarifying sentence.

### `src/server/prompts/work.ts`

Drop the ban sentence. The paragraph that carried it keeps only its first half — read the
context file — and gains one sentence explaining why the file exists:

> Mojito already read all of that from Linear, so you never have to spend tokens re-reading it.

That is a statement about where the data came from, not an instruction about Linear usage.
It earns its place: without it a session may re-fetch what it already has.

The header comment records why the prompt is silent, so a future reader does not "fix" the
omission.

### `src/server/prompts/conflict.ts`

Drop the same sentence from the merge-fix prompt. Header comment points at `work.ts` for
the reasoning rather than repeating it.

### `src/server/prompts/perimeter.ts`

Created and then deleted over the course of this ticket. There is no shared paragraph to
share, so there is no file.

### `tests/server/prompts.test.ts`

Two tests replace the old `it("forbids Linear access in both prompts")`:

- **`gives neither prompt any instruction about using Linear`** — a banned-phrase list
  covering both polarities (prohibitions: `never use any linear`, `linear perimeter`,
  `read-only`, `sub-issue`, …; permissions: `without asking`, `file a new issue`,
  `is allowed and expected`, …), asserted absent from both prompts. Both wrong answers have
  shipped once each, so the guard has to catch either.
- **`names Linear in the work prompt only as the source of the data Mojito already read`** —
  pins the three legitimate mentions (the opening line, the token-saving sentence, the
  asset-auth clause) and asserts the count is exactly three. A fourth mention means an
  instruction crept in.

The rest of the file is untouched: placeholder interpolation, the distinct result contracts
(`ready-for-qa` vs `merged`), merge-mode completion steps, blocker sanitizing and the asset
paragraph all still hold.

### `CLAUDE.md`

The "**Spawned sessions never touch Linear** (no MCP, no API); their prompt forbids it."
line is replaced by the opposite: the prompts say nothing about Linear, deliberately, and
the `setIssueStatus` reasoning is recorded so nobody re-adds a ban to fix a non-problem.

## Out of scope

- Any change to `SessionResult`, `sessionResult.ts`, `hookHandler.ts` or the GUI. The
  ticket's `createdIssues` field was struck at the design gate — Mojito does not need to
  know which issues a session opened.
- Any code-level guard (e.g. a `permissions.deny` block in the per-session settings file).
  This ticket removes instructions rather than adding enforcement. Noted only because it
  was raised in review — and it is partly impossible anyway, since Linear's MCP routes
  issue creation and update through one `save_issue` tool, so denying updates would kill
  creation too.
- Deduplicating follow-ups against existing Linear issues.

## Testing

`npx tsc --noEmit && npx vitest run`.

Baseline note: `tests/server/docFiles.test.ts` has 2 pre-existing failures on macOS
(`/var` vs `/private/var` tmpdir symlink resolution in the test itself). Unrelated to this
ticket and left untouched.

## Acceptance criteria

The ticket's criteria assumed the fix was *wording*. The user amended that during the work:
the fix is *deletion*, so the criteria that specified prompt copy no longer apply. Recorded
in full rather than quietly dropped.

1. ~~The work prompt explicitly permits creating new issues and explicitly forbids every
   operation on the worked ticket.~~ **Struck.** The prompt says neither. Removing the ban
   is what unblocks follow-up creation; an explicit permission is what made the session
   file them without asking.
2. ~~The perimeter is written so the agent does not have to ask the user for permission.~~
   **Struck, deliberately inverted.** Asking is the correct behaviour for an outward-facing
   write, and it is what a session with no instruction does by default.
3. ~~Issues the session creates land in the worked ticket's project and cite its
   identifier.~~ **Struck.** With no instruction, this is the user's call at confirmation
   time, where they have the context to make it.
4. ~~The result file lists the created identifiers (`createdIssues`) for logging.~~
   **Struck** at the design gate — Mojito does not need to know.

What remains, and what QA should check: the blanket ban is gone from **both** prompts, the
prompts carry no replacement instruction about Linear, and the session is told the context
file spares it a re-read.
