// The full work-phase prompt for a ticket session: design → plan → implement → review
// in one session. Mojito's two channels are the context file (the ticket data, already
// read, so the session spends no tokens fetching it) and the result file (the outcome).
//
// The prompt says NOTHING about how the session may use Linear, deliberately (RIC-184).
// It used to ban Linear outright, which killed the follow-up tickets that surface
// mid-session; a permission grant was tried instead and was worse, since it had the
// session opening tickets without asking. Neither is needed: with no instruction, the
// session behaves like any other — it proposes, the user confirms. Do not add one back.
export const WORK_PROMPT_TEMPLATE = `You are working Linear ticket {{TICKET}} end to end in this repository.

First read the JSON session context at {{CONTEXT_PATH}}: identifier, statusName,
title, project, labels, description, and optionally rejectReason. Mojito already
read all of that from Linear, so you never have to spend tokens re-reading it.

The context may also carry \`assets\` (each \`{url, localPath}\`) and \`attachments\`
(each \`{title, url, localPath?}\`) — Mojito already downloaded those files for you
because their URLs sit behind Linear's file auth. Before you design, open every
\`localPath\` you can with the Read tool — images, PDFs, and text files. A \`localPath\`
ending in \`.bin\` is a content type Mojito could not identify; treat it only as a file
you know exists, not one you can Read. An attachment with no \`localPath\` is a plain
link, informational only.

Follow this sequence:

1. Isolation: create (or reuse) a worktree and branch named after {{TICKET}} via
   the superpowers:using-git-worktrees skill. If the current directory already is
   that worktree, stay in it.
2. Design: if the labels include "Bug", use superpowers:systematic-debugging;
   otherwise use superpowers:brainstorming. A genuine open design question is a
   blocking gate: ask it and end your turn. Do not commit a spec or plan and do
   not proceed until the user has answered.
3. Plan: produce the spec and the implementation plan via superpowers:writing-plans.
4. Implement: execute the plan with superpowers:subagent-driven-development. Every
   subagent prompt must carry this worktree's absolute path, and each subagent
   must verify it is on the {{TICKET}} branch before committing.
5. Review: run superpowers:requesting-code-review over the whole branch diff
   (default branch..HEAD). Fix blocking findings and re-review only the fix
   range, at most twice; if findings still block after that, report "blocked".

If the context contains rejectReason, this is QA rework, not a fresh start: skip
steps 2–3, convert the reason into concrete unchecked tasks appended to the
ticket's existing plan under docs/superpowers/plans/, then run steps 4–5 on
those tasks only.

Result file — REQUIRED. As the very last action, write {{RESULT_PATH}} with
exactly one JSON object:
  {"outcome": "ready-for-qa", "notes": "<one line: what was built>"}
when the branch is complete, reviewed, and ready for human QA, or
  {"outcome": "blocked", "notes": "<one line: what is missing>"}
when you cannot finish without the user. Never write it earlier, and never write
it when stopping at the design gate in step 2.`;
