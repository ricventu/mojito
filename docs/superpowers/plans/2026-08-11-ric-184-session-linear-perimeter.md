# RIC-184 — Remove the Linear instruction from the session prompts

> **Historical note.** This plan originally built a shared `LINEAR_PERIMETER` constant in
> `src/server/prompts/perimeter.ts` and spliced it into both prompt templates. That constant
> was written, tightened once after code review, loosened twice by the user, and finally
> deleted — the shipped answer is that the prompts say nothing about Linear at all.
>
> Its step-by-step code blocks have been dropped rather than rewritten a fourth time: they
> restated the shipped code, and every revision left them stale. `src/server/prompts/` is
> the source of truth; the spec carries the reasoning. What follows is the record of what
> changed and how it was verified.

**Goal:** Delete the blanket Linear ban from both session prompts and put nothing in its
place, so a spawned session behaves like one the user started by hand.

**Architecture:** A deletion in two template files, plus one sentence saying the context
file spares the session a re-read. No new module, no runtime code, no result-file contract
change.

## Global Constraints

- All code artifacts in English: identifiers, comments, commit messages, docs.
- The prompts carry **no** instruction about Linear usage, in either direction — not a ban,
  not a permission. This is the entire point of the ticket.
- `src/server/sessionResult.ts`, `src/server/hookHandler.ts` and the GUI are untouched. The
  ticket's `createdIssues` field was struck at the design gate.
- `render()` (`src/server/prompts.ts:18-26`) is not modified.
- Verification: `npx tsc --noEmit && npx vitest run`.
- Baseline: `tests/server/docFiles.test.ts` has **2 pre-existing failures** on macOS (`/var`
  vs `/private/var` tmpdir symlink resolution inside the test). Unrelated; not regressions.

---

### Task 1: Delete the Linear instruction from both prompts ✅

**`src/server/prompts/work.ts`** — dropped `Never use any Linear tool, MCP server, or API in
this session — Mojito manages Linear for you.` from the context paragraph, which now ends
with `Mojito already read all of that from Linear, so you never have to spend tokens
re-reading it.` The asset paragraph's rationale changed from "this session holds no Linear
credential" (false once nothing is banned) to "their URLs sit behind Linear's file auth".
The header comment records why the prompt is silent, so a future reader does not "fix" it.

**`src/server/prompts/conflict.ts`** — dropped the same sentence; header comment points at
`work.ts` for the reasoning.

**`src/server/prompts/perimeter.ts`** — deleted, along with both imports. Nothing left to
share.

**`src/server/ticketAssets.ts:110`** — the same stale "holds no Linear credential" rationale
in a code comment, corrected to match.

**`CLAUDE.md`** — the **Linear** bullet states the decision, why both alternatives were
rejected, and the `setIssueStatus` reasoning for why nothing needs enforcing. The **Session
context** bullet's credential clause corrected the same way.

**`tests/server/prompts.test.ts`** — `it("forbids Linear access in both prompts")` replaced
by two guards, plus a `flat()` helper that normalizes whitespace so assertions do not couple
to line wrapping:

- `gives neither prompt any instruction about using Linear` — a blocked-phrase list covering
  both polarities (prohibitions: `never use any linear`, `linear perimeter`, `read-only`,
  `sub-issue`, …; permissions: `without asking`, `file a new issue`, `is allowed and
  expected`, …). Both wrong answers shipped once each, so the guard catches either.
- `names Linear only as the source of the data Mojito already read` — pins the mention count
  in both prompts: 3 in the work prompt (opening line, token-saving sentence, asset-auth
  clause) and 1 in the merge-fix prompt (opening line). This is the stronger of the two
  guards: any new sentence about Linear fails it however it is phrased, where the
  blocked-phrase list only catches wordings someone thought to block.

Everything else in the test file is untouched: placeholder interpolation, the distinct
result contracts (`ready-for-qa` vs `merged`), merge-mode completion steps, blocker
sanitizing, and the asset paragraph present in work / absent in merge-fix.

**Verification:** `npx tsc --noEmit` clean; `npx vitest run` → 750 passed, 2 failed (the
pre-existing `docFiles.test.ts` cases above), 752 total.

---

## Spec coverage

| Spec requirement | Where |
|---|---|
| Ban deleted from the work prompt | `work.ts` |
| Ban deleted from the merge-fix prompt | `conflict.ts` |
| No replacement instruction of either polarity | both templates; both test guards |
| Context file framed as a token saving | `work.ts` context paragraph |
| Asset rationale corrected | `work.ts`, `ticketAssets.ts`, `CLAUDE.md` |
| Decision + `setIssueStatus` reasoning recorded | `CLAUDE.md`, spec |
| No `createdIssues`, no `SessionResult` change | Global Constraints |
