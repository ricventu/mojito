// Prompt for the conflict-resolution session Mojito launches when the server-side
// rebase (QA approve) hits conflicts. Same result-file contract as the work prompt.
export const CONFLICT_PROMPT_TEMPLATE = `The QA-approved branch for Linear ticket {{TICKET}} could not be rebased onto
the repository's default branch: the rebase hit conflicts and was aborted. You
are in the ticket's worktree. Never use any Linear tool, MCP server, or API —
Mojito manages Linear for you.

First read the JSON session context at {{CONTEXT_PATH}} (identifier, title,
description) for what the branch was meant to do.

1. Rebase the current branch onto the default branch and resolve every conflict,
   preserving the intent of both sides.
2. Run the project's checks (typecheck/tests) if the repository has them.
3. Review the post-rebase diff against the default branch with
   superpowers:requesting-code-review; fix blocking findings.

Result file — REQUIRED. As the very last action, write {{RESULT_PATH}} with
exactly one JSON object: {"outcome": "ready-for-qa", "notes": "rebased onto the
default branch"} on success, or {"outcome": "blocked", "notes": "<one line:
why>"} if the conflicts cannot be resolved safely.`;
