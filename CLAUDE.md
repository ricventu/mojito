# Mojito

Mojito is a Next.js + TypeScript app (GUI + local server) that manages Linear tickets
per project and runs them through a collapsed lifecycle:
`Backlog/Todo → In Progress → To QA → Done`.

Mojito owns the whole lifecycle — there is no external plugin:

- **Prompts**: `src/server/prompts.ts` builds the full session prompt (work phase,
  conflict resolution) from templates in `src/server/prompts/`. Sessions are spawned as
  detached tmux sessions running `claude … '<prompt>'`. The work prompt carries only
  Mojito's two channels — the context file it reads, the result file it writes; no phase
  sequence, no skills, no worktree rule. Which skills to use, how much design up front,
  and whether the work takes a branch at all is the session's call, same as a hand-started
  session. The asset paragraph (`src/server/prompts/work.ts`) is interpolated only when
  the launch actually downloaded something.
- **Linear**: `src/server/linear.ts` is a direct GraphQL client. Mojito writes status
  transitions and assignee — never comments, and no longer issue creation (see **New
  ticket** below; `createIssue` is gone). **The prompts say nothing about Linear to the
  spawned session** (RIC-184) — no ban, no permission. It used to ban
  Linear outright, which killed the follow-up tickets that surface mid-session; an explicit
  permission was tried next and was worse, since it had sessions opening tickets without
  asking. With no instruction the session behaves like any other: it proposes, the user
  confirms. `tests/server/prompts.test.ts` fails on either polarity creeping back. Nothing
  needs enforcing anyway — `setIssueStatus` writes the target state unconditionally, so
  Mojito's move is last-write-wins whatever the session did.
- **New ticket**: the sheet takes a note and images, not a title — `POST /api/tickets`
  uploads the images to Linear itself (the API key never leaves the server, and those
  URLs sit behind Linear's file auth), writes the raw note plus the resulting URLs to
  `<stateDir>/drafts/<random>.json` (`ticketDraft.ts`), and launches an **intake session**
  (`launchIntakeSession`) that reads that draft, rewrites it, titles it, and creates the
  issue *itself* through the Linear MCP. Mechanically a custom session — no ticket, no
  launch context, no result file — because the issue it creates is the whole outcome;
  Sonnet at medium effort is inlined there, since no status names this work. It registers
  under its own `kind: "intake"` and its own `mojito-intake-<slug>-<hex>` id all the same
  (RIC-251): it is the one session on the board Mojito started on the human's behalf
  rather than at their pick, and filed under Custom it was indistinguishable from a claude
  session they opened themselves. The kind is *presentation only* — `sessionStatus` buckets
  it under `INTAKE_STATUS` ("New ticket", `indigo`, a hue globals.css already declares and
  no lifecycle status claims) so it groups and filters on its own, and everything
  behavioural still treats it as custom. `handleHook` and `SessionCard` therefore key on
  "is a **ticket** session" rather than naming the kinds that are not: written the other
  way, the next kind added would fall into the lifecycle path and start writing Linear
  statuses for a ticket it does not have. Orphan adoption reads the kind off the id prefix,
  which is the only thing left to read it from once the sidecar is gone. Ticket copy
  goes out in Italian whatever the note was written in, and the session labels the issue
  with one of Linear's `Bug`/`Improvement`/`Feature` (the names are the team's own
  capitalization, passed to the MCP verbatim) instead of announcing its nature in a
  description heading — RIC-223. The label is offered, never demanded: at most one, and
  none when none of the three fits, since a prompt that insists gets whichever is least
  wrong. Priority is deliberately left alone: the prompt says
  nothing about it, so a note that does not raise urgency does not get a guessed one.
  The images half of the prompt is interpolated only when the draft carries urls
  (`INTAKE_IMAGES_PARAGRAPH`, same pattern as the work prompt's asset paragraph), so an
  imageless note is never sent embedding an empty array or leaving a bare attachments
  heading behind. This is the one deliberate exception to the silence above:
  `prompts/intake.ts` is the only prompt that mentions Linear on purpose, which is why the
  RIC-184 guard in `tests/server/prompts.test.ts` runs over the work and merge-fix prompts
  only. Nothing needs a confirmation step — the MCP write raises Claude Code's own
  permission prompt, and the sheet lands the human in that terminal (201 answers with the
  session meta) so they see it — in a **new browser tab** since RIC-224, so that jotting a
  ticket down never costs you the page you were on. The tab is reserved with a
  `window.open("", "_blank")` on the click itself, *before* the POST: a window.open that
  runs after an `await` is a popup as far as the browser is concerned and gets blocked.
  A `null` handle (blocked anyway) falls back to the in-place navigation the sheet did
  before, rather than dropping the permission prompt; any path that never hands the
  reserved tab a url closes it instead of leaving an `about:blank` behind. The sheet
  itself is owned by `page.tsx`, not by `UnifiedList`, and rendered into every branch —
  the action is on the terminal header too (`.term-actions`), where the list is not
  mounted. Which project it opens on is `newTicketProject` (`src/lib/sheetProject.ts`):
  the open session's own project on a terminal (a ticket jotted down while watching a
  session almost always belongs to that repo), otherwise the project the board is
  filtered on — `soleProject`, i.e. only when the filter names exactly one, since the
  filter holds a set since RIC-225 and one field cannot honour two. **New session**
  pre-selects the same way — it is only reachable from the list, so it takes
  `filters.project` through that same `soleProject`. Both sheets share the Project field
  through `useProjectPicker`, the glue half of the usual split (cf. `useToken` ÷
  `resolveInitialToken`): the rule lives in `knownProject`, which resolves a name
  `projects.json` has since dropped back to General, because a select on a value with no
  option shows nothing and submits whatever it fell back to. An *empty* project list
  reads as "not loaded yet", not "none exist" — /api/projects answers a render after the
  sheet opens, and resolving against that first empty pass would throw every
  pre-selection away.
- **Worktrees**: a ticket launch resolves its worktree first via the legacy branch-name
  scan (`resolveWorktree`, any worktree whose branch carries the ticket id, wherever it
  lives), then the fixed `.claude/worktrees/<ticket>-<slug>` path Mojito itself creates
  (`worktree.ts`). When neither exists, the launch sheet — via
  `GET /api/tickets/[id]/worktree-status` — asks the human whether to create one and from
  which base branch; "no" opens in the repo root and asks again next launch, same as
  before this existed. The base branch list offers the repo's **remote-tracking branches
  as well as its local ones, remotes first** (`listRemoteBranches` + `baseBranchOptions`),
  and pre-selects `origin/<default>` (`defaultBaseBranch`) — the local `main` of a
  checkout Mojito's own sessions work in is routinely behind the server, and a worktree
  cut from it starts with someone else's merged work missing. Nothing is deduplicated:
  `main` and `origin/main` are different commits, which is the whole point. `origin/HEAD`
  is dropped as a duplicate of whatever it points at, matched on `refname:strip=2` because
  `refname:short` shortens that ref to a bare `origin` that looks like a branch name.
  Picking a remote base does not by itself make it current — a tracking ref is only as
  fresh as the last fetch — so `createTicketWorktree` fetches **that one branch** before
  `worktree add` when the base names a remote (`splitRemoteRef` against `git remote`, so
  `feature/foo` is not mistaken for one). Best effort, like the setup script: a fetch that
  fails leaves the worktree branching off the ref git already had, with a warning, and the
  warning field now joins the several a creation can collect (`worktreeResult`). The sheet
  also carries an explicit **Fetch** action beside the field
  (`POST /api/tickets/[id]/worktree-fetch` → `fetchTicketRemotes`, `git fetch --all
  --prune` and then re-read the status), for the branch created since the sheet opened; it
  is a POST because it writes refs, where worktree-status stays read-only. A prune can drop
  the selected ref, so the answer goes through `reconcileBaseBranch` — a select holding a
  value with no option renders blank and submits whatever it fell back to. The field is a
  searchable `Combobox` rather than a `Choice` now that the list is roughly twice as long.
  Since RIC-243 that question has a third answer, "Existing":
  the same endpoint also reports the repo's other worktrees (`listPickableWorktrees`),
  and picking one opens the session there instead of creating anything. The **New
  session** sheet has the same field for a project-scoped session or terminal, fed by
  `GET /api/projects/worktrees` — hidden for General (the home directory is not a repo)
  and for a project whose repo has no linked worktree, since a select with one option is
  noise. Three labels only (`No`/`Existing`/`Yes`), because `.btns` gives each an equal
  third of a sheet 320px wide on the narrowest phone. The pick rides the launch body as
  `worktree` and **is never trusted**: it names the directory a session is spawned in, so
  `resolveWorktreePick` echoes it back only when the repo really has a worktree there —
  an invented path, or one removed between the sheet's fetch and the tap, falls back to
  the repo root with the usual echoed warning rather than failing the launch. It wins over
  every other cwd rule (`defaultResolveCwd`), including the ticket's own worktree: it is
  the only one of them that is an explicit choice. `WorktreeAnswer.kind`
  (`src/lib/worktreeChoice.ts`) is the discriminator the sheet renders on and is
  deliberately not derived from the picked value — a user who picks and then resets the
  select to "Repo root" would otherwise have the select vanish under them with no way
  back. Bare and prunable worktrees are never offered: the first has no working tree, the
  second's directory is gone, so git would refuse to work in either.
  Creation (`createTicketWorktree`) is a plain `git worktree add` Mojito runs itself,
  never delegated to the session — separate from the work prompt's
  continued silence on branches (the "no worktree rule" above is about what the *prompt*
  tells the session, not what Mojito does before spawning it). If the repo has
  `scripts/init-worktree.sh`, Mojito runs it once inside the fresh worktree; if not,
  or if either step fails, the launch is never blocked — a warning is echoed as the first
  line of the session's own terminal instead. **Mojito's own repo has had one since
  RIC-240** (`pnpm install`, then the pty perms fix): before pnpm a per-worktree
  `node_modules` was a ~520 MB copy nobody would pay for automatically, so every
  worktree arrived empty and each session populated it by hand as its first act.
  It deliberately does not copy `.env.local` in — keeping `LINEAR_API_KEY` and
  `MOJITO_TOKEN` out of spawned sessions is the whole point of RIC-207. A project's
  toolbar (see **Project toolbar** below) carries a "Create worktree script" action that
  opens a plain Claude session in the project root to write that script — offered only
  while the repo has none, tested with the same `existsSync` this launch path uses.
- **Session context**: the launcher writes `<stateDir>/context/<id>.json`
  (`{identifier, statusName, title, project, labels, description, assets?, attachments?}`);
  the prompt embeds the path. It exists to save the session the tokens of
  re-reading Linear, not to fence it in. `assets`/`attachments` point at files
  Mojito already downloaded into the sibling `<stateDir>/context/<id>-assets/` directory,
  since those URLs sit behind Linear's file auth.
- **Outcome channel**: at the end of every round — not just once — the session writes
  `<stateDir>/results/<id>.json` (`{outcome: "ready-for-qa" | "merged"}`), a bare status
  signal with no notes. The Stop hook reads it (`src/server/hookHandler.ts`) and Mojito
  moves the status.
- **QA gate**: approve runs the server-side rebase+merge (`src/server/merge.ts`,
  zero tokens on the clean path; a Claude session only on conflict). When there is
  nothing to merge — the branch already landed outside Mojito, or the checkout holding
  the work sits on the default branch (`hasNothingToMerge` in
  `src/server/ticketMergeState.ts`) — the gate offers `mark-done` instead, which writes
  Done straight and runs no git. That answer always comes from git: anything undecidable
  (no resolvable main checkout, a failing git call) answers "there IS something to merge",
  because a wrong `true` writes Done over unmerged commits. There is no reject:
  a ticket that fails QA is reworked by typing into its still-live work session, and the
  ticket parks at To QA meanwhile.
- **Startup stall**: every state Mojito shows comes from a Claude Code hook, and the first
  of them (SessionStart) only fires once claude has booted — so anything that blocks it
  *before* boot leaves no hook at all and the session pinned at its launch-time "starting"
  (RIC-222). The blocker in practice is the workspace-trust prompt: a "General" custom
  session runs in the home directory, whose trust answer Claude Code does not persist, so
  it hit that prompt on *every* launch and never left "starting" once. Worktrees are fine —
  trust is inherited from the parent repo — and there is no CLI flag to pre-trust an
  interactive session, so the fix is not to avoid the prompt but to stop lying about it:
  `watchStartupStall` (`src/server/startupStall.ts`), armed by every launcher that
  registers at "starting", flips a session still there after `STALL_GRACE_MS` to
  needs-input with an alert — the same "open this terminal and answer it" signal a
  permission prompt raises. It needs the bus (the client refetches the session list only
  on an event, and a stalled launch emits none of its own), which is why `bus` rides on
  `LaunchDeps`; a caller without one simply has no watch. Two cases it deliberately leaves
  alone: a session a hook has already spoken for, and one whose tmux is gone — that
  belongs to `Registry.recover`/`sweepOrphans`, which drop it rather than badge it. A late
  SessionStart maps straight back to running, so a merely slow boot self-corrects. A shell
  session arms nothing: it fires no hooks ever, which is why it launches at "running".
- **Session lifetime**: Mojito never ends a session by itself. The only path that closes
  one is an explicit user action — `DELETE /api/sessions/[id]` → `closeSession`, behind the
  Kill button. Automatic paths (a QA verdict, a relaunch from the sheet) may drop only the
  *registration* of a session whose tmux is already gone, via `retireDeadSession`
  (`src/server/retireSession.ts`); a launch that finds the tmux name still held answers 409
  and tells the user to kill it first. This replaced `supersedeSession`, which closed the
  ticket's work session on every verdict — killing mid-turn the very session the gate's
  rework loop depends on. `tests/server/retireSession.test.ts` and the "never closes a
  session" case in `tests/server/verdictRoute.test.ts` fail if that comes back.
  `closeSession` asks and never forces: Ctrl-C, then Ctrl-D *re-sent on every poll* —
  claude answers the first one with "Press Ctrl-D again to exit", so a single EOF left
  it running until the wait was up and the session was then torn down under a live
  claude, losing whatever it had not written out. There is no `kill-session` fallback
  at all now: a session claude will not leave answers 409 and keeps its tmux, its
  registration and its card, and both call sites surface that refusal
  (`src/lib/dismissSession.ts`) rather than swallowing the status, which used to make a
  refused dismiss look exactly like a successful one. The real-tmux cases in
  `tmux.integration.test.ts` cover both halves — a process that wants a second Ctrl-D,
  and one that ignores every signal.
- **Child environment**: nothing Mojito spawns inherits `process.env` — every spawn goes
  through `sanitizeEnv`/`spawnEnv` (`src/server/childEnv.ts`). Mojito's own environment is
  not a neutral base: `npm start` runs `cross-env NODE_ENV=production`, adds npm's `npm_*`
  block and prefixes PATH with Mojito's own `node_modules/.bin` chain, and `loadEnvConfig`
  then layers `.env.local` (`LINEAR_API_KEY`, `MOJITO_TOKEN`) on top. All of it used to
  reach the shell of every agent session (RIC-207), where the damage is silent and
  destructive rather than cosmetic: under `NODE_ENV=production` a bare `npm install`
  *deletes* a workspace's already-installed devDependencies and exits 0 — measured again
  on npm 11 in RIC-240, where it took typescript, tsx and vitest out of a tree that had
  them. Note the one thing that measurement *changed*: **pnpm 11 does not do this.** A
  bare `pnpm install` keeps devDependencies whatever `NODE_ENV` says; only an explicit
  `--prod` strips them. That makes the scrubbing belt-and-braces for Mojito's own repo
  and no less necessary in general — a session works in whatever repo it is pointed at,
  on whatever package manager and version that repo pins. Two layers, both
  needed — the sanitized `env` on the spawn covers a tmux server Mojito itself starts, and
  `tmuxEnvArgs` adds session-scoped `-e` overrides for what a *pre-existing* tmux server
  still leaks globally (that server outlives Mojito and hands its global environment to
  every session created afterwards). Overrides are emitted only for keys actually leaking,
  so a clean server keeps them genuinely absent rather than pinned to `""`. `.env` keys are
  not hardcoded anywhere: `registerEnvFileKeys` in `server.ts` diffs `process.env` across
  the loader, so a credential added to `.env.local` later is scrubbed without anyone
  remembering to update a list. Covered at both ends — pure unit tests in
  `tests/server/childEnv.test.ts` and a real-tmux case in `tmux.integration.test.ts` that
  asserts a pane sees neither `NODE_ENV`, nor a leaked key, nor `TURBOPACK`. Deliberately
  *not* extended to Mojito's own git/`gh`/`systemctl` calls, which no `NODE_ENV` branch
  touches. `.env` is not the only thing that writes to `process.env` after boot, which is
  the RIC-246 half: **Next mutates its own process** — `next()` sets `TURBOPACK`, and
  building the server sets `NEXT_DEPLOYMENT_ID` — and both used to ride into every session,
  where `TURBOPACK` is read by *any* repo's `next` as that repo's bundler choice. Observed
  as a Playwright suite dying because its `pnpm dev --webpack` exited 1 on "Multiple bundler
  flags set: TURBOPACK=1, --webpack" (the value need not be `1`; every reader of it in Next
  is a truthiness check, so Mojito's own `auto` collides identically). Two mechanisms again,
  and the split matters: `server.ts` diffs `process.env` across `next()`+`prepare()`
  (`snapshotEnvKeys`/`registerEnvKeysAddedSince`, the generalized halves of
  `registerEnvFileKeys` — a diff spanning statements, since those two writes sit either
  side of an `await`), which catches whatever Next injects next without naming it; *and*
  the bundler-selection keys (`TURBOPACK`, `NEXT_RSPACK`, the three `IS_*_TEST`/
  `NEXT_TEST_USE_RSPACK` switches) are in `DROP_EXACT` unconditionally, because a diff
  cannot see a value that was **already there when Mojito booted** — which is exactly the
  self-perpetuating case: a leaking Mojito poisons the tmux server's global environment,
  and a Mojito launched from one of its shells inherits the variable and hands it on. Note
  the diff must close before the first spawn, i.e. before `server.ts`'s tmux calls.
- **Status model**: `src/server/statusModel.ts` is authoritative; `src/lib/status.ts`
  mirrors it for presentation and a sync-guard test ties them together. Work-phase
  sessions share a single tmux id `mojito-<ticket>-work` across Backlog/Todo/In
  Progress/To QA (see `tmuxName` in `src/server/sessionKey.ts`), so a session relaunched
  while the ticket sits at the gate takes its predecessor's id; the conflict session is
  `mojito-<ticket>-conflict`. A session's `launchStatus` is written once at launch and
  never rewritten, so the list never filters or groups a session on it while its ticket
  can answer: `liveStatuses` (`src/lib/ticketFilter.ts`) maps identifier → current status
  off the *unscoped* ticket list, and `sessionStatus`/`filterSessions`/`mergedStatuses`
  take it. Without that, a status chip manufactured orphans — a Todo chip dropped a
  ticket already at To QA while keeping its session, which then had nothing to nest under
  and surfaced alone in "No ticket". `launchStatus` stays the fallback for a session whose
  ticket was never fetched or is gone, which is the case the loose group exists for.
- **Terminal header**: `terminalHeadModel` (`src/lib/terminalHeader.ts`) is everything the
  header renders, and it takes the session's *live ticket* — the whole `TicketSummary`
  from the polled list, not just its status — because two of the three things it shows
  are only there: the current status (`launchStatus` is a launch-time snapshot) and the
  issue's `url`, which the ticket id links to (see **Ticket id links** below). The header
  also carries two "open this directory elsewhere" actions: Warp
  (`warp://action/new_tab?path=…`) and VS Code (`vscode://file/…/`, trailing slash =
  folder), both pointed at `session.cwd` — the worktree when the ticket has one, the
  repo root otherwise. They are anchors handing a
  url to the OS, not a server-side `open -a`: no endpoint and no child process, and the
  machine with Warp and VS Code on it is the machine the browser runs on. `openInApp.ts`
  builds them, refuses anything not absolute (a relative path resolves against whatever
  the *receiving* app considers current) and answers `""` for "no link", which is how the
  header decides not to render the action. Both are hidden below 480px: a phone has no
  handler for either scheme, so the tap ends in an OS error, and the two glyphs cost the
  title width it needs there. They are also the only labels in the app deliberately left
  as ASCII rather than icons (see **Icons**): `>_` and `</>` say *terminal* and *code
  editor* in a way two lucide pictograms do not, and being phone-hidden they never sit
  next to the icon row anyway.
- **Terminal geometry**: the pty's size is the *terminal's* size, always — one invariant,
  and `syncGeometry` (`src/lib/terminalFit.ts`) is the only place it is maintained. It
  separates two things that used to be one early return. **Re-fitting** (re-measuring
  xterm against `.term-body`) is refused while the mobile keyboard is up — the terminal
  keeps the rows it had and the bottom-anchored `.term-body` shows the bottom of them, so
  the TUI's input line stays on screen without claude's whole layout being reflowed
  against a band iOS will not report reliably — and refused for a mid-animation band
  (`isUsableGeometry`, which a shrinking viewport collapses to 1 row). **Publishing** the
  geometry to the pty is refused *never*. Skipping the send alongside the fit is RIC-258:
  `ptyGateway` spawns its `tmux attach` at 80x24 and the client's resize frame is the only
  thing that ever corrects it, so a socket that (re)connected with the keyboard up — a
  phone back from the background with the keyboard restored, a deploy, any of the 1.5s
  reconnects — left the pane at 24 rows for good, and nothing re-sent it until the keyboard
  closed. tmux then repainted the TUI into the top 24 rows of a grid xterm still held ~52
  of, and the bottom-anchored view showed only the blank rows beneath it: a wholly black
  terminal with the input line off the top, which is how the bug was reported and exactly
  what a 24-into-52 repaint reproduces. Re-sending a size the pty already has is a no-op,
  so the send is unconditional rather than conditioned on anything having changed.
- **Terminal composer**: the compose toggle, first key in the accessory bar, opens a real
  `<textarea>` you write in, then inject into the terminal through xterm's own
  paste path (`AccessoryBar`, `term.paste`). It exists because **the terminal is
  not a text field**, which is the root cause of a whole family of iOS
  complaints: xterm takes input through one hidden helper textarea sized to a
  single cell at `zIndex: -5`, cleared on Enter/Ctrl-C/blur and never reconciled
  with what the pty holds. So a long-press offers no "Incolla" (the terminal is a
  canvas); holding the spacebar turns the keyboard into a caret trackpad but
  nothing in xterm turns a caret move into `\x1b[C`/`\x1b[D`, so the gesture
  slides a caret around a scratch buffer and sends nothing; and dictation
  arrives **twice**, because xterm's `_inputEvent` insertText path and
  `CompositionHelper`'s `compositionend` path can each deliver the same phrase
  — the `cancel(ev)` meant to stop the first cannot, since `input` is not a
  cancelable event. In a plain textarea all three work natively, and you get to
  read a dictated prompt back before it reaches claude. It leads the row because
  `.acc` is `overflow-x: auto` and a phone shows about ten of its keys — the
  head is the only slot that never needs a swipe. Its icon is lucide's
  `SquarePen` (see **Icons** below; an emoji there rendered in its own colours
  and weight, off from the text keys beside it, and `✎` was too faint to find).
  **Do not "simplify" this back into a paste box**: paste was only the first
  symptom noticed. It is a toggle and not an always-on row because it grows into
  `.term-body`, whose whole
  visible band is ~13 rows once the keyboard is up (`keyboardInset.ts`) — the
  same budget that already costs `.term-head` its place. Injecting sends no CR:
  a dictation mangles names and code tokens, so the review step is claude's own
  input line, and `⏎` is one tap away in the same bar. Growth is
  `composerHeight` (`src/lib/composerHeight.ts`) ÷ the measuring effect, the
  usual split; it answers a **border-box** height (`scrollHeight` never counts
  the border) and `null` while `getComputedStyle().lineHeight` is still
  "normal", which is why `.composer-input` declares `line-height` explicitly and
  *after* `font: inherit`. The xterm-level dictation duplication is deliberately
  left unfixed — the composer is the path that does not double, and patching
  xterm's internals needs an event trace off a real device first.
- **Copying text out**: the terminal itself cannot be selected, on any platform, and
  four independent things say so — claude's TUI turns on mouse tracking, so xterm
  calls `_selectionService.disable()` for the duration; xterm.css sets
  `.xterm { user-select: none }`; xterm's always-on `mousedown` listener
  `preventDefault()`s unconditionally; and a touch drag produces no mouse events at
  all, on top of `.term-root .xterm { touch-action: none }` and Mojito's own
  capture-phase `touchmove`. **The renderer is not among the reasons** — selection
  was equally impossible under the DOM renderer before RIC-239, so reverting that
  buys nothing and pays for it with the exact case WebGL was adopted for. Two
  separate fixes, therefore. On a Mac, `macOptionClickForcesSelection`
  (`terminalOptions.ts`) is the whole of it: xterm's one escape hatch is
  `shouldForceSelection`, which off a Mac reads `shiftKey` — so shift+drag already
  worked on Linux and Windows — but on one reads `altKey && thisOption`, and the
  option defaults to `false`, which is why macOS had no gesture at all. It also
  turns Option+drag from a column selection into a flowing one
  (`shouldColumnSelect` excludes exactly this case): a rectangle cut out of a TUI
  is not what anyone copies. On a phone the answer is the composer's, in the other
  direction — a **real text surface**: the accessory bar's last key opens a
  `<pre>` holding the buffer as text (`bufferText`, `src/lib/terminalText.ts`),
  where iOS's own long-press → "Copia" works. A copy *button* is not an option
  there and never will be while `server.ts` is plain http: `navigator.clipboard`
  does not exist outside a secure context, so nothing but native selection can
  reach the clipboard from the phone. A `<pre>` and not a `<textarea>` because
  focusing one raises the keyboard. `bufferText` reads the whole active buffer with
  no branch — the alt buffer has no scrollback, so a TUI yields exactly its screen
  while a shell yields its history too — joins wrapped rows to what they continue
  (a path broken across rows is the main thing being copied, and a newline in the
  middle of one ruins the paste), and trims blank rows at the ends only. It also
  trims each line's right-hand padding **itself**, because xterm will not:
  `translateToString(true)` stops at the last cell with content
  (`getTrimmedLength`) and a space *is* content, so the spaces tmux paints its
  pane with survive it. Left in, every line comes out the full width of the pane
  and the paste re-wraps wherever it lands — which reads as the copy having
  invented line breaks, and is exactly how it was first reported. The lesson for
  the tests is the sharper one: the fake that stood in for `translateToString`
  trimmed with a regex of its own, so it asserted the assumption instead of
  xterm's behaviour and the bug shipped green. It is a
  snapshot, deliberately: text reflowing under a half-placed selection handle
  cannot be copied.
- **Ticket id links**: every `RIC-…` label Mojito shows is the way to open that issue on
  Linear (RIC-242) — the board cards, the loose session cards, the launch sheet header and
  the terminal header all render it through one `TicketLink` component, with
  `ticketLinkUrl`/`ticketUrls` (`src/lib/ticketLink.ts`) as the pure half. The url is
  never built: it rides on `TicketSummary.url` straight from Linear's API (`issue.url`),
  because the alternative is Mojito learning a workspace slug and keeping it, and a
  guessed url is worse than no link — so a ticket with no url (a custom session, one that
  has left the open list, a list cached before the field existed) renders its id as the
  plain `.id` span it always was. `ticketLinkUrl` also drops anything that is not
  http(s): the value lands in an `href` a human taps, where a `javascript:`/`data:` one
  would run in Mojito's own origin. `ticketUrls` mirrors `liveStatuses` and wants the
  *unscoped* ticket list for the same reason — a session whose ticket the filters hide is
  exactly the one that ends up in the loose group, and its url is fine.
  Both card kinds had to give up a slice of their tap region for this: the id row now
  sits *outside* `.tap`, because a `role="button"` element's children are presentational
  to ARIA, so a link nested in one is announced as part of the button and cannot be
  reached on its own — the same nesting rule that made those regions divs instead of
  buttons (`tapProps`). The cost is a strip of card beside the id that opens nothing; the
  title, labels and session rows below it still open the sheet. Two `.id` labels are
  deliberately left as plain text: `AlertLayer`'s, whose whole surface is the tap that
  takes you to the session waiting for input, and the docs header's, where the identifier
  is prose (`RIC-242 · docs`) rather than a label.
- **Client url state**: the address bar is the single source of truth for which view is
  open and how the list is filtered (RIC-204). `src/lib/appLocation.ts` is the pure
  codec — `parseLocation`/`formatLocation` over `/`, `/session/<id>`,
  `/session/<id>/docs`, `/docs/ticket/<id>`, `/docs/session/<id>` plus the five filter
  params (`project` repeats — one parameter per selected project, since a project name
  is free text and could hold whatever separator a joined list picked) — and
  `useAppLocation` is the only `window.history` glue, so everything testable stays
  testable in the node-only vitest setup (no jsdom, no RTL; same split
  as `resolveInitialToken` ÷ `useToken`). The five `mojito-list-*` localStorage keys and
  `mojito-tab` are gone, along with `usePersistedState` itself: localStorage is shared
  between browser tabs, which is exactly what made two tabs unable to hold two filter
  sets. Consequences worth knowing: filters are serialized on *every* path, so leaving
  the list for a terminal or a doc and coming back does not drop them; defaults are
  omitted, so the unfiltered board is a bare `/` (and the PWA's `start_url` therefore
  always opens clean); typing in the filter box replaces the entry instead of pushing
  one per keystroke; and the page lives at `src/app/[[...view]]/page.tsx`, an optional
  catch-all, which is what makes a hard reload of `/session/<id>` serve the app instead
  of a 404 — `/api/*` and `public/` still win as the more specific routes. `/stacks` was
  a view of its own until RIC-253 and is now simply unrecognised, which parses as the
  list: an old bookmark lands on the board rather than on a blank page. That catch-all
  also matches `/ws/pty` and `/ws/events`, which is what `claimUpgrades`
  (`src/server/nextUpgrade.ts`) exists for: Next attaches an `upgrade` listener of its
  own on the first request it handles and ends any socket whose path its router
  matches — it leaves *unmatched* paths alone precisely so a custom WS server can have
  them, which is why the websockets were fine before the catch-all and black after it.
  Every terminal came up empty and every live update stopped, and the client's 1.5s
  reconnect loop turned that into the pty leak `ptyGateway` now guards against. A
  launch also seeds its answer into the session list before navigating (`withSession`),
  since an unknown `/session/<id>` corrects itself back to the board. The other half of
  that file is `nextUpgradeHandler`, which picks the handler Mojito gives Next its *own*
  `/_next` upgrades — the internal `upgradeHandler` getter, not the public
  `getUpgradeHandler()`. In dev the public method resolves to the inner NextNodeServer,
  whose `handleUpgrade` is a documented no-op, so every socket handed to it was dropped
  and Fast Refresh silently never connected — broken since well before Next 16, and
  invisible because the HMR path also moved (`/_next/webpack-hmr` → `/_next/hmr`, both
  under the `/_next` prefix `server.ts` routes on). Next's own suppressed listener
  always used the getter; now so do we. In-app Back
  buttons step through real history when the previous entry is ours, tracked as a depth
  counter in `history.state` (`src/lib/navDepth.ts`), and fall back to a url otherwise,
  so a link opened straight into a terminal never backs out of Mojito.
- **Live updates**: `/ws/events` is the *only* thing that refreshes the session list —
  `useSessions` has no poll of its own (tickets do, every 45s). And the bus is
  fire-and-forget: `EventBus.emit` walks whoever is subscribed right now, nothing is
  buffered and nothing replays. So a gap in that socket used to be a **permanent** gap in
  what the board showed: whatever changed while it was down was never learned, and a card
  sat at the last state it heard — for a session that had just launched, "starting" forever
  (RIC-251). The fix is not a longer retry, it is refetching on every successful connection:
  `openEventStream` (`src/lib/eventStream.ts`) owns the dial-and-reconnect loop and calls
  `onConnect` each time, first connection included, with `useEvents` reduced to the glue
  (url + effect lifetime) so the loop is testable against a fake socket in the node-only
  vitest setup — the usual split. The New-ticket flow hit this on *every* use, which is why
  it was reported there: it opens the session in a new browser tab, so the tab holding the
  board goes to the background exactly as its intake session boots, and SessionStart,
  PostToolUse and Stop all fire into a socket nobody is listening on. A deploy does the same
  to every open client. `visibilitychange` covers the other shape of the same miss — a
  phone can leave the socket half-open, frames going nowhere and no close event ever
  arriving, so the reconnect never happens; coming back to the tab refetches. Both resync
  sessions only: a flapping connection must not turn into a burst of Linear queries.
- **Board scope**: the board shows only the projects `projects.json` maps —
  `GET /api/tickets` passes `listMappedProjects` into `listOpenIssues`, which scopes the
  Linear query itself (`project: { name: { in: $projects } }`, names as a variable, never
  interpolated). It is a *query* filter and not a screen filter on purpose: a workspace
  project Mojito has no path for can offer nothing but tickets that answer `no-repo` when
  you tap them, and they were also eating the `first: 100` budget the mapped projects
  share. A ticket with **no** project is scoped out along with them, on the same test:
  Mojito resolves a session's directory from the project, so a project-less ticket is
  exactly as unlaunchable as one naming an unmapped project. The one case that survives
  the scope is an **empty** map, which scopes nothing and returns the whole workspace:
  `loadProjectMap` swallows a parse error and answers `{}`, so scoping on that would
  blank the entire board
  with no explanation whenever the file is malformed. Note the consequence for `no-repo`,
  which is now nearly unreachable from the board and stays only as the launch's own guard.
- **Project filter**: the board's project filter offers *every configured project*, not
  only the ones its open tickets name (RIC-225) — `mergedProjects` unions
  `/api/projects` (`useProjects`) with the names the tickets and sessions on screen
  carry, so a project whose tickets are all closed is still reachable. Since **Board
  scope** above the ticket half of that union is a fallback rather than the routine case
  (an unmapped project's tickets no longer arrive at all); what it still covers is the
  render or two before `/api/projects` answers, a *session* whose project left the map
  after it was launched — its card is on screen, so its name must stay filterable — and
  the fail-open path, where a malformed projects.json empties both sides. It is a
  multi-select with a search box rather than a chip row: the list is now as long as
  projects.json, which a horizontally scrolling row cannot show, and "these two
  projects" is a state chips cannot express at all. So `ListFilters.project` is a
  `string[]` where `[]` means every project — `filterTickets`/`filterSessions` treat a
  non-empty set as OR — and `activeFilters` reports **one chip per selected project**
  (RIC-252), each carrying its name as the entry's `value` so its ✕ drops only that one.
  It used to be a single chip listing them all, on the grounds that the select two rows
  up is where an individual project comes back off; but the chip's ✕ is the only removal
  the sticky bar offers, and it took the whole selection with it — so the way back to one
  project was to reopen the select and untick, which reads as the bar refusing to undo
  what it reports. Clear all still drops the lot, and now shows for two selected projects
  since it is no longer what a single chip's ✕ already does. Which values a chip drops is
  the pure `removeFilter(filters, chip)`, not a Record of setters in `UnifiedList` — the
  rule is testable in the node-only setup that way, and one `onFilters` call keeps a
  removal to one history entry. The status chips stay chips: five values that never grow.
  The select's place in the toolbar is the top row, beside the three actions
  (RIC-226): the toolbar reads project select + `+ Ticket`/`+ Session`/`Clean up`,
  then the status chips, then the text field, then the sticky active-filter badges.
  The search box used to lead, which spent the first row on the control of last
  resort — project and status are one tap each — and pushed the actions down. Where
  four controls do not fit (`.filter-actions` is a wrapping flex row, the select
  `flex: 1 1 100%` below 560px) the select keeps a line of its own and the buttons
  split the next one, rather than shrinking the one control whose whole job is
  naming the selected projects. On the shared line the buttons are label-width
  (`flex: 0 1 auto`) at their own `.btn.sm` height and the select takes the slack:
  stretched to a quarter of the toolbar each they were the loudest thing on the
  board. On their own line they stay `flex: 1 1 0` — there the width is a tap target.
- **Project toolbar**: each project section's divider is a management toolbar
  (`ProjectToolbar`, RIC-253) — Start, Stop, Logs, Pull (or **Pull & deploy** on the
  server's own checkout), Push, and **Create worktree script**. These are the actions
  that used to be the **Stacks tab**, which is gone: the board's divider was already the
  only thing naming a project and did nothing, while the actions belonging to a project
  lived one tab away on a screen that listed the same names again. `page.tsx` therefore
  has one view left and **no bottom nav at all**: a tab bar whose one destination is the
  page you are already on is furniture, so the two things it still carried moved into
  the board's own toolbar — the settings gear closes the actions row (top-right of the
  board) and the needs-input count is the amber pill immediately left of it, counted off
  the *unfiltered* session list since it answers "is anything waiting for me". The empty
  board spells Settings out as a text button instead: the toolbar is not rendered there,
  and an empty board (a Linear outage, a bad deploy) is exactly when you want the
  "Pull & deploy" that lives in that sheet. Which actions a row offers is the pure
  `projectActions`
  (`src/lib/projectToolbar.ts`) and the rules are the old panel's, kept whole — notably
  **Stop shows whenever there is a stack**, since detection can read "crashed" while
  orphan processes still hold the ports. Two things are new. `hasWorktreeScript` on
  `StackRow` is why "Create worktree script" can hide itself once the script exists; it
  tests *existence*, not the +x bit, because that is what `createTicketWorktree` checks
  before running it. And `withManagedSections` (`unifiedRows.ts`) pads a section for
  every **explicitly selected** project the board has no rows for — a mapped project
  whose tickets are all closed would otherwise have no divider to hang its toolbar off,
  where the Stacks tab listed every mapped project unconditionally. Only selected ones,
  so the unfiltered board does not become a list of everything in projects.json; the
  filter already offers every configured project (RIC-225), so selecting one is the way
  in. The buttons are **icon-only** (lucide + `title`/`aria-label`): six of them have to
  share a line with a project name on a 320px phone, which no set of labels does, and
  `.proj-head` wraps them onto a right-aligned second line where they still do not fit.
  The two exceptions are worth knowing: "Resolve with Claude" keeps its words because it
  appears only after a pull has already failed, and `useStacks` polls at 15s rather than
  the panel's 5s now that it runs on the app's default view — every action refreshes on
  completion, so the interval only has to catch a stack that changed outside Mojito.
  "Pull & deploy" is deliberately *also* still in the Settings sheet, which is where it
  has room for the paragraph explaining that it restarts the server; both call sites
  share the one `useSelfUpdate` in `page.tsx`, so they cannot disagree about whether a
  deploy is in flight.
- **UI kit**: the selects are shadcn/ui sources under `src/components/ui`
  (`select`, `popover`, `command`, plus `combobox` and `choice`, the two app-level
  shapes: searchable — single or multi — and a short fixed list). They are the only
  Tailwind in the app; everything else is the hand-written CSS in `globals.css`. Pasted
  in essentially unedited and bridged rather than restyled: `tailwind.config.ts` maps the
  colour names shadcn asks for (`popover`, `accent`, `input`, `ring` …) onto `--ui-*`
  variables that `globals.css` defines in terms of Mojito's own tokens, which is why a
  regenerated component comes out looking like Mojito. `--ui-*` and not shadcn's bare
  names because Mojito already owns `--accent` as its brand lime where shadcn means
  "subtle hover" by it. Two things bite when editing them: the popovers portal to
  `<body>`, so they need `z-[200]` to clear the sheets (100) and the docs overlay (120),
  and they must be `modal` — a non-modal popover lets its dismissing tap through to
  `.sheet-backdrop`, which closes the whole sheet. Overriding a `globals.css` element
  rule (`input:focus`) takes a `focus:` variant, not a plain utility: element +
  pseudo-class outranks a bare class.
- **Icons**: every icon is a **lucide** stroke svg (`lucide-react`, already a
  dependency for shadcn), imported per icon and sized by a `size={n}` prop —
  *not* by a Tailwind class, which would spread the utilities past
  `src/components/ui`. Controls carrying one take `.icon` (`globals.css`), whose
  two rules centre the svg and `display: block` it off the text baseline, whose
  descender gap otherwise makes an icon-only control taller than its text
  siblings. What the sweep replaced is why the rule exists:
  **colour emoji** (📎 📄, rendering in their own palette and weight, ignoring
  the theme) and **punctuation impersonating a pictogram** — `×` *and* `✕` *and*
  a 20px `×` for three different "close" buttons, `‹` (a left angle quote) for
  Back, `⚙` needing `font-size: 16px` to read at all. Text metrics never centre
  and never scale with a stroke, so each one was nudged into place by a
  hand-tuned `font-size`/`line-height`; those are gone. Two deliberate
  exceptions, both of which a future cleanup will want to re-break: the
  accessory bar's key row (`↑ ↓ ← → ⏎ ⇧⏎ Esc Tab ^C`) is the *names of keys*,
  not icons — no lucide glyph spells "Esc" — and Warp/VS Code's `>_` / `</>`
  (see **Terminal header**). Prose in comments may still name a glyph; markup
  must not.
- **Installable app (PWA)**: `public/manifest.webmanifest` plus the `appleWebApp` and
  `icons` metadata in `src/app/layout.tsx`. The whole subject is governed by one fact:
  **Chromium only offers "Install" on a secure origin, and `server.ts` speaks plain
  http** (RIC-250). So the browsers split in two. Safari needs nothing — iOS "Add to
  Home Screen" and macOS "Add to Dock" both work off the http URL, which is why the
  installed-standalone safe-area handling in `globals.css` predates this ticket and
  was already observable. Chromium installs only on `localhost` (the one http origin
  browsers trust) unless you front the server with TLS, which `make https` does via
  `tailscale serve --bg $PORT` — a real Let's Encrypt certificate, because an origin
  with a *certificate error* is not secure either and a self-signed listener inside
  `server.ts` would install nothing. Nothing about the transport changed; Serve adds
  a front door beside the http ones. What the manifest actually needed was the second
  icon size: Chromium wants a 192 **and** a 512 and only had the 192, which is why
  desktop Chrome offered nothing even on localhost. Icons all come from
  `public/icon.svg` via `scripts/gen-icons.sh` — the drawing is inside the 80%
  maskable safe circle so one file serves `purpose: "any maskable"` rather than
  needing a padded second copy, and the script **lints the SVG first** because
  `qlmanage` answers malformed XML with WebKit's error page and will rasterize *that*
  into a perfectly valid PNG of red error text, exit code 0. `public/sw.js` stays a
  deliberate no-op with no fetch handler: Chromium dropped the service-worker clause
  from its criteria, an offline cache is meaningless for a client of a same-machine
  server, and a cached shell would fight "Pull & deploy". It is not deleted only
  because an installed worker outlives the file that installed it. Two consequences
  to know: the token gate shows up once per install (`start_url` is `/` and carries
  no token, and an installed app need not share `localStorage` with the browser —
  iOS gives home-screen apps their own container), and Next 16 emits the standardized
  `mobile-web-app-capable`, not the apple-prefixed tag, which costs nothing since iOS
  takes standalone from the manifest's own `display`.
  `tests/client/manifest.test.ts` asserts Chromium's criteria over the real file
  including that every icon `src` exists on disk — the failure mode with no other
  symptom is a renamed icon, which silently un-installs the app.
- **Safe areas**: full-bleed is a *pair* of settings — `viewportFit: "cover"` and
  Apple's `black-translucent` status bar, both in `layout.tsx` — and together they
  mean the layout viewport is the whole screen, with the clock and the home indicator
  sitting **over** it. So every surface that touches an edge has to pay
  `env(safe-area-inset-*)` itself; one that does not simply has its content under the
  system UI. Only two ever did, which is what RIC-257 reported: on an iPhone 11 the
  board's toolbar and the terminal's header both rendered beneath the clock. The four
  insets are aliased once in `:root` as `--sat`/`--sar`/`--sab`/`--sal`, which writes
  the `0px` fallback in one place and — the useful half — lets a desktop browser render
  the real phone geometry by overriding four values, the only way to *see* this layout
  off a device. Changing the status bar style would zero the insets (iOS then lays the
  viewport out below the status bar) and double every gap already paid, so the pair
  moves together or not at all. Three placements are deliberate and not obvious:
  the top inset is on **`.term-root`**, not on `.term-head`, because the header is
  unmounted while the keyboard is up and the terminal would slide back under the clock
  mid-typing (`.term-root` takes `background: var(--surface)` so the strip it pays for
  reads as the header's own); `.acc` pays the bottom inset **except** under
  `.term-root.kbd`, since with the keyboard up that band's bottom edge is the keyboard
  and not the home indicator, and paying it there costs ~2 of the ~13 visible rows;
  and `.page`'s bottom is the bare `var(--sab)` — it used to add the 64px of the bottom
  nav, which RIC-253 removed, and the board now has no fixed bottom surface to clear at
  all. `.page::before` is the opaque strip that keeps cards from
  scrolling under the clock — `black-translucent` asks for exactly that and nobody
  wants to read it. `tests/client/safeArea.test.ts` asserts the tokens and every
  surface that spends them, in the shape of the manifest test above: this is CSS that
  is invisible on a desktop and in the node-only test setup alike (both report every
  inset as 0), so nothing else in the tree would notice it going away.
- **Projects map**: `~/.config/mojito/projects.json` (Linear team key → project name →
  repo path), resolved by `resolveProjectsPath` in `src/server/config.ts`: env
  `MOJITO_PROJECTS` → `~/.config/mojito/projects.json`.

## Toolchain

- **pnpm, not npm** (RIC-240). One lockfile, `pnpm-lock.yaml`; `package-lock.json` is
  deleted *and* gitignored, because Turbopack picks the project root by finding a
  lockfile and two of them is a coin flip. `packageManager` in `package.json` pins the
  exact pnpm, which corepack then enforces. What bought the migration is worktrees:
  Mojito makes one per ticket and each wants its own `node_modules`, which under npm was
  ~520 MB and minutes of install — ~4 GB across the eight worktrees on the machine when
  this was measured. Under pnpm three full installs that `du` reports as **1.6 GB** cost
  **31 MB** of real disk and ~3s each, which is what makes `scripts/init-worktree.sh`
  worth running automatically. Read that number honestly: the store pays for a version
  of a package **once**, machine-wide, so the marginal worktree is ~10 MB and seconds
  while the first install of a *new* dependency set still costs what it costs. It is the
  per-worktree marginal cost the migration was after, and that is the one that collapsed.
  **The mechanism is not hard links, and that matters.** On APFS pnpm clones (`clonefile`)
  rather than links: blocks are shared copy-on-write, but every checkout gets its own
  **inode**. So `du` and `stat` both lie about the saving — measure it as free-space delta
  across an install, never with `du` — and, the useful half, a `chmod` in one checkout
  does *not* reach the store or its siblings. That is what settles `fix-pty-perms`, the
  one thing this migration was expected to change the semantics of: it does not. The
  chmod is as local under pnpm as it was under npm (verified: store and sibling installs
  stayed 644 while one went 755), and it is still *needed* — pnpm leaves node-pty's
  `spawn-helper` mode 644 exactly as npm did. It moved to `scripts/fix-pty-perms.sh` so
  that `predev`, `prestart` and `init-worktree.sh` can all reach it without one package
  manager shelling out to another. On a filesystem with no `clonefile` (ext4 on the Linux
  box) pnpm falls back to real hard links and the chmod *would* be global — harmless there
  only because the glob matches darwin/win32 prebuilds, which nothing on Linux executes.
  The whole space argument rests on store and worktrees sharing a **volume**; they do
  (`~/Library/pnpm/store` and `~/code/…`, same `/dev/disk3s5`). Re-check with `stat -f %d`
  on both before trusting any of the numbers above on another machine.
  Two settings in `pnpm-workspace.yaml` are load-bearing and both fail *silently*:
  `allowBuilds` (pnpm 10+ skips install scripts unless the package is named — no
  `node-pty` means no pty binding at all, no `esbuild` means tsx cannot run `server.ts`
  or one test; `allowBuilds` is pnpm 11's name for pnpm 10's `onlyBuiltDependencies`,
  and it is an object, not a list), and `enablePrePostScripts: true`, since `predev`/
  `prestart` are the only thing putting the +x back and pnpm's default for that has
  moved between majors. `tests/repo/packaging.test.ts` fails if any of it regresses.
  Rollback, if it ever comes to that, is `git revert`, `npm install`, and putting
  `npm run dev` back in `scripts/dev-supervisor.sh` — no data migration, nothing outside
  `node_modules`.
- **Next 16 + Turbopack** (RIC-227): `next build` and the custom dev server both run on
  Turbopack, Next 16's default. Getting there cost the repo's ESM-style `.js` import
  specifiers in `src/server/**` (`from "./config.js"` → `from "./config"`, 87 of them):
  they only ever resolved because `next.config.mjs` taught **webpack**
  `resolve.extensionAlias`, and Turbopack has no equivalent — `experimental.extensionAlias`
  is on its explicitly-unsupported list. Nothing else wanted them: `tsc` runs
  `moduleResolution: "Bundler"`, and tsx and vitest both resolve extensionless. Next 16
  turns a leftover `webpack` key into a hard `process.exit(1)` rather than a warning
  (auto-mode never falls back), so the config now carries `turbopack: {}` and no webpack
  block. `--webpack` / `next({ dev, webpack: true })` remain the documented escape hatch
  if Turbopack ever blocks a change.
- **`next dev` is unreachable from a phone**, which matters because Mojito is a
  phone-first app and its own tickets ask for measurements taken there. Next 16 blocks
  cross-origin `/_next/*` dev resources for any host but `localhost`, so loading the dev
  server over the LAN — or even `127.0.0.1` — 403s every JS chunk. React then never
  hydrates, and the failure wears a **completely misleading face**: the token gate
  renders (it is server HTML) but its Save button is inert, so it looks like the token
  is being rejected rather than like the app never booted. `allowedDevOrigins: ['<lan-ip>']`
  in `next.config.mjs` lifts it, but for anything performance-related use
  `pnpm build && pnpm start` instead — production has no such restriction, and a dev
  build's rendering is not what you want to benchmark anyway.
- Two Next 16 behaviours worth knowing: `next dev` writes to `.next/dev` (covered by the
  `.next/` ignore) and takes a **lockfile** there, so only one dev server per checkout —
  a stale lock from a hard-killed process is detected by pid and taken over, which is
  what keeps `scripts/dev-supervisor.sh`'s kill-and-respawn recovery working. And
  `next dev` **writes a managed block into `CLAUDE.md`** itself
  (`<!-- BEGIN:nextjs-agent-rules -->`); it is committed because Next re-adds it on
  every dev run, and `agentRules: false` in the config is the way to opt out.
- **Running it**: `make prod` is the way — one `next build`, then that build served
  under `scripts/prod-supervisor.mjs`, which polls `/api/health` and restarts the
  server after 3 consecutive failures. It watches no files: a rebuild takes the app
  down for its whole duration, and this is the checkout Mojito's own sessions write
  in, so "someone saved a file" is not a deploy trigger. A source change goes live
  only when asked — SIGUSR2 to the pid in `.prod-supervisor.pid`, which is what the
  "Pull & deploy" button sends (`src/server/selfUpdate.ts`). That cycle is
  `pnpm install` → stop → build → start, every time: the install is unconditional
  because a pull can bring a lockfile change and nothing in the supervisor watches for
  one, and on an unchanged tree it costs seconds — cheap next to serving a build whose
  dependencies are missing. Conditioning it was tried and dropped: neither "the manifests
  moved" (content hash) nor "the pulled commits touched them" (git diff) is worth the
  machinery when the answer is almost always yes and a needless install costs seconds.
  The install runs with the old server still up (a lockfile the registry cannot satisfy
  therefore aborts the cycle with the current build still live), and it is the only step
  the watchdog is held off for, since pnpm rewriting `node_modules` under the live server
  can make it briefly unhealthy and a restart there is pure harm. A **typecheck** step
  used to precede the stop, to spend a doomed deploy's failure before the downtime rather
  than after; it is gone — `next build` type-checks anyway, so it bought ordering, not
  safety, and a tree that does not compile is the editor's problem, not the deploy's. `runSelfUpdate`
  therefore signals on **every** outcome, up-to-date or updated: with no watcher, a pull
  that brings commits triggers nothing by itself, and this checkout has no post-merge
  hook (that is the Linux box's trigger). Double-triggering on Linux is free — systemd
  coalesces a `start` on an active unit, `triggerRebuild()` coalesces a second SIGUSR2.
  `make start` (dev server + `scripts/dev-supervisor.sh`, HMR, `tsx watch`) is the
  other option and is unchanged.
- **The Makefile has no `set -e` on macOS.** It declares
  `.SHELLFLAGS := -eu -o pipefail -c`, and macOS ships **GNU Make 3.81**, which
  predates `.SHELLFLAGS` (3.82) and ignores it outright — the same version gap the
  file's header already notes for `.ONESHELL:`. So every recipe there runs under a
  plain `bash -c`: a command that fails mid-recipe is stepped straight over and the
  target still exits 0. Found the hard way in RIC-250, where `make https` printed
  "Open the Tailscale Serve URL" under a banner containing no such URL because
  `tailscale serve` had exited 1 against a stopped tailnet. Check the status yourself
  in anything that has to run on the Mac (`if ! cmd; then … exit 1; fi`, as `https`
  does). `restart` may keep leaning on `-e` — it is the Linux box's path, and that
  make is new enough.
- **xterm 6**: a clean bump. Nothing Mojito uses was touched by the 6.0 removals
  (`windowsMode`, `fastScrollModifier`, the canvas renderer, `overviewRulerWidth`), and
  the viewport/scrollbar rewrite is invisible here because `globals.css` only ever
  styles the `.xterm` root, never xterm's internals.
- **Terminal renderer**: the browser terminal draws on the GPU via
  `@xterm/addon-webgl` (RIC-239) — the DOM renderer's worst case is exactly
  Mojito's, tmux repainting claude's full-screen TUI, where every changed cell is
  DOM work. The addon is the only one of xterm 6's that was adopted; the rest were
  evaluated and rejected in RIC-227. `attachWebglRenderer`
  (`src/lib/terminalRenderer.ts`) is the whole of it, and it exists for the
  **fallback**, not the load: Safari drops a WebGL context when the tab goes to the
  background — a phone in a pocket, the same scenario `startHeartbeat` is for — and
  an unhandled loss leaves the terminal **black** rather than degrading. Two facts
  read off the addon's source rather than assumed: `dispose()` *is* the fallback
  (`activate` registers a disposable that calls
  `renderService.setRenderer(core._createRenderer())`, so the DOM renderer comes
  back with the buffer intact), and `onContextLoss` is **not** `webglcontextlost` —
  the renderer `preventDefault()`s that and waits 3s for `webglcontextrestored`, so
  a context the browser gives back never reaches us and `onContextLoss` means "gone
  for good". Hence the fall back to DOM is permanent: re-loading a context that was
  refused once only flips the terminal between renderers. Loading is allowed to
  fail silently (the constructor throws on Safari < 16, `activate` throws without
  WebGL2) because this runs partway through the mount — an escaping throw would
  take the socket, the resize handlers and the touch scroll with it and leave a
  dead terminal where a DOM-rendered one would have worked. Costs ~29KB gzipped,
  and only on the `ssr:false` terminal chunk, which the board never loads.
  `globals.css` is untouched, and `touchScroll` still measures `term.element` (the
  `.xterm` root) — the WebGL canvas goes inside `.xterm-screen`, so the row-height
  maths is unchanged.

## Tests

`pnpm typecheck && pnpm test` — server logic lives under `src/server/`, tests under
`tests/server/`. The tmux integration test is skipped when `tmux` is unavailable, and is
the one file in the suite that is occasionally flaky under parallel load (it drives a real
tmux server); re-run it alone before believing it. `tests/repo/packaging.test.ts` guards
the packaging itself — one lockfile, the two `allowBuilds` entries, the pre/post-script
setting, and that no script shells out to another package manager.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
