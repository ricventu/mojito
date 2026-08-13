// The work-phase prompt for a ticket session. It carries only what a session cannot work out
// for itself: Mojito's two channels — the context file it reads, the result file it writes.
// Everything else is a session-level decision, exactly as in a hand-started session: which
// skills, how much design up front, and whether the work is worth a worktree and a branch at
// all (a one-line fix is not). A ticket that ends up with no branch of its own is not a
// problem for the QA gate — it answers "nothing to merge" and offers Mark Done.
//
// The prompt says NOTHING about how the session may use Linear, deliberately (RIC-184).
// It used to ban Linear outright, which killed the follow-up tickets that surface
// mid-session; a permission grant was tried instead and was worse, since it had the
// session opening tickets without asking. Neither is needed: with no instruction, the
// session behaves like any other — it proposes, the user confirms. Do not add one back.
export const WORK_PROMPT_TEMPLATE = `You are working Linear ticket {{TICKET}} end to end in this repository.

First read the JSON session context at {{CONTEXT_PATH}}: identifier, statusName,
title, project, labels, and description. Mojito already read all of that from Linear,
so you never have to spend tokens re-reading it.

{{ASSETS_PARAGRAPH}}Result file — REQUIRED. As the very last action of a round, write {{RESULT_PATH}}
with exactly this JSON object:
  {"outcome": "ready-for-qa"}
It is the only signal Mojito has to move {{TICKET}} to To QA. Your session stays
alive afterwards: when the human comes back with QA feedback, work it and write the
file again at the end of that round.`;

// Interpolated only when the launch actually downloaded something (see buildWorkPrompt).
// Ends with a blank line so the template reads the same with or without it.
export const ASSETS_PARAGRAPH = `The context also carries \`assets\` (each \`{url, localPath}\`) and \`attachments\`
(each \`{title, url, localPath?}\`) — Mojito already downloaded those files for you
because their URLs sit behind Linear's file auth. Before you start, open every
\`localPath\` you can with the Read tool. A \`localPath\` ending in \`.bin\` is a content
type Mojito could not identify; treat it only as a file you know exists, not one you
can Read. An attachment with no \`localPath\` is a plain link, informational only.

`;
