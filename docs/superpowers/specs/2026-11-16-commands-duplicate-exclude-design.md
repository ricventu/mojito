# Commands: Duplicate, and projects excluded from a general command (RIC-587)

A small change to the quick commands of RIC-581 (`2026-11-13-quick-commands-design.md`).

## Why

- **Duplicate**: a command's prompt is the work; writing a variant (another project, another model)
  should start from a copy, not a blank form.
- **Exclude**: a command for "All projects" is offered on every mapped project, and some projects
  are not meant for it (Clean on a repo that has no branches to clean). Until now the only way
  out was deleting it and re-creating it per project.

## Approaches

- **A. Per command (chosen)**: an "All projects" command carries the projects it skips. Flexible
  (Clean everywhere but one repo, Deps everywhere but another), and the choice sits in the one
  form where the command is edited.
- B. Per project: a "no general commands" switch on each project. Simpler, but all or nothing.

The human picked A, and Duplicate with it.

## Design

- `Command.excluded: string[]` — project names an "All projects" command is not offered on.
  Meaningful only with `project: null`; with a project it is always `[]`. `CommandSchema` defaults
  it to `[]` (a stored command and an older peer's list have none) and canonicalises it: trimmed of
  repeats, sorted with plain `sort()`, emptied when `project` is set. ≤ 100 names, each non-empty.
  Every reader goes through the schema (`CommandsSettingBody`, `sanitizeCommand`), so the stored
  setting and the import path agree.
- `commandsFor(effective, project)`: a general command is offered unless the project is in its
  `excluded` — the board's Clean button and menu and the server's run route all go through it, so an
  excluded command is a 404 on the run route too.
- A project **rename** renames it inside every `excluded`; a **removal** drops it from them (an
  edited default whose only edit was that exclusion is then equal to its default and is dropped by
  `normalizeCommands`).
- Settings → Commands form: under Project, when it is "All projects", a "Skip on" select (the
  mapped projects not skipped yet; picking one adds it and the select empties again) and, under it,
  a badge per skipped project with an ✕ to offer the command there again — an excluded name no
  longer mapped shows as a badge too, so it can be removed. Asked by the human over a list of
  checkboxes, which grows with every project. The card shows "Not on a, b" under such a command's
  name.
- **Duplicate**: a button in the edit dialog's footer. It turns the dialog into "New command" with
  the form's current fields (unsaved edits included — a "save as copy"), no id, and the name
  `"<name> copy"` (numbered `copy 2`, `copy 3`… when taken, clipped to 40). Nothing is written until
  Save; the original is untouched. Offered on defaults too: a copy of Clean is a custom command.
- Import: a peer's `excluded` is taken as is; names this instance does not map are harmless (they
  match no project) and show in the form to be unchecked.

## Left to the builder

Layout details of the checkbox list (it must fit 320px); tests for the shared functions, the form
logic in `lib/commandForm.ts`, and the server's rename/remove and run route.
