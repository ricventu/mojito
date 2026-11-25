# Command run sheet (RIC-622)

## Intent

A quick command (RIC-581) ran on one tap, on this instance only, always with its stored model and
effort. RIC-622: a command also carries a **worktree** preference, and running one first opens a
sheet, like the ticket's Launch form, where model, effort and worktree can be changed for that run
and the **host** picked.

Model and effort were already part of `Command` (edited in Settings → Commands); only the
worktree preference is new.

## Approaches

- **A. A peer runs its own copy** (same id, through the relay). Reuses the existing route, but the
  peer may not have the command, or holds another version of it; the host list would have to read
  each peer's commands first.
- **B. This instance sends the command** (prompt + the sheet's picks) and the host runs exactly
  that. What the sheet shows is what runs, on any host that maps the project. Needs a run route
  that takes the command in its body; an older peer answers 404. **Picked by the human.**

## Design

- `Command.worktree: boolean` — `CommandSchema` defaults it to `false` (older rows and peers have
  none); `sameCommand` compares it, so a default edited only in it is stored. Clean ships `false`.
  Settings → Commands' dialog gets a "Work in a worktree" switch.
- `POST /api/projects/:name/commands/:id/run`, body `CommandRunBody` `{prompt, model, effort,
  worktree}` → `CommandResult`. The id is only the session's suffix (`mj-<slug>-<id>`): it must be
  a plain word or a `cmd-<hex6>` id, never looked up in this instance's list (on a peer it is the
  sender's command). The prompt ≤ `COMMAND_PROMPT_MAX`; with `worktree` the fixed
  `WORKTREE_INSTRUCTION` is appended as the last line (the ticket launch's rule). Answers like the
  old route: `alreadyOpen` for this command's live session (its run options are then ignored), 409
  with `sessionId` for another's, 400 for an unusable path, 404 for an unknown project.
- The old `POST …/commands/:id` (no body, the stored command) stays for a client still on an older
  build (an installed app resumes its page).
- The relay allowlist gains `POST projects/:project/commands/:id/run`.
- Web: picking a command (the commands menu, Clean's button) opens `RunCommandSheet` (bottom sheet
  / centred dialog, `SHEET_CONTENT_CLASS`) held by `ProjectSection`: the command's icon and name
  with the project, its prompt (read-only, clamped), **Run on** (`freeLaunchHosts` for the
  project: shown with peers, every host listed, one that cannot run it disabled with why), Model /
  Effort (`LaunchOptions`), "Work in a worktree", Run. The picks start from the command and are
  for this run only (nothing is saved). Run posts to `hostApi(host, …/run)`, writes the answered
  session into `qk.sessions` / `qk.peers`, toasts and opens its terminal (`sessionHref`, with the
  host) — as a command did before. A 409 with `sessionId` is a toast with Open.

## Non-goals

- Saving the sheet's picks back into the command.
- Two sessions of one command in one project: still one per project and command.
- Clean keeps its button and badge; it opens the sheet like every command.
