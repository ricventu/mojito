// Prompt for the merge-fix session Mojito launches when the server-side merge
// (QA approve) cannot complete on its own — a rebase conflict, a diverged default
// branch, a dirty worktree, or any other git failure. The human already approved
// the merge, so this session finishes it and reports "merged" through the result
// file; Mojito then moves the ticket to Done.
//
// Like the work prompt, this says nothing about how the session may use Linear — see the
// header of ./work.ts for why (RIC-184).
export const MERGE_FIX_PROMPT_TEMPLATE = `The QA-approved branch for Linear ticket {{TICKET}} could not be merged
automatically. The server-side attempt stopped with:

{{BLOCKER}}

You are in the ticket's worktree, and the human has already approved this
merge — your job is to finish it.

First read the JSON session context at {{CONTEXT_PATH}} (identifier, title,
description) for what the branch was meant to do.

1. Diagnose the blocker above (rebase conflicts, a default branch that
   diverged from its remote, uncommitted files, ...) and resolve it,
   preserving the intent of both sides. Never discard commits and never
   force-push the default branch.
2. Rebase the current branch onto the up-to-date default branch if it is not
   already on top of it.
3. Run the project's checks (typecheck/tests) if the repository has them.
4. If the rebase changed the branch's content, review the post-rebase diff
   against the default branch with superpowers:requesting-code-review and fix
   blocking findings.
5. Complete the merge: {{COMPLETE_STEP}}

Result file — REQUIRED. As the very last action, write {{RESULT_PATH}} with
exactly one JSON object: {"outcome": "merged", "notes": "<one line>"} once
step 5 is done, or {"outcome": "blocked", "notes": "<one line: why>"} if the
merge cannot be completed safely.`;

// Step-5 instruction per approved merge mode.
export const COMPLETE_STEP_LOCAL =
  "fast-forward the default branch's main checkout to this branch " +
  "(`git merge --ff-only` from the repository root). Do not push.";
export const COMPLETE_STEP_MR =
  "push the branch and open a merge request (`gh pr create` or `glab mr create`, " +
  "matching the remote's host) — the approver chose MR mode.";
