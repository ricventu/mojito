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
  issue *itself* through the Linear MCP. It is a plain custom session — no ticket, no
  launch context, no result file — because the issue it creates is the whole outcome;
  Sonnet at medium effort is inlined there, since no status names this work. Ticket copy
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
  before this existed. Since RIC-243 that question has a third answer, "Existing":
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
  line of the session's own terminal instead. A project's Stacks panel has a "Create
  worktree script" action that opens a plain Claude session in the project root to write
  that script.
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
  destructive rather than cosmetic: under `NODE_ENV=production` a bare `pnpm install`
  *deletes* a workspace's already-installed devDependencies and exits 0. Two layers, both
  needed — the sanitized `env` on the spawn covers a tmux server Mojito itself starts, and
  `tmuxEnvArgs` adds session-scoped `-e` overrides for what a *pre-existing* tmux server
  still leaks globally (that server outlives Mojito and hands its global environment to
  every session created afterwards). Overrides are emitted only for keys actually leaking,
  so a clean server keeps them genuinely absent rather than pinned to `""`. `.env` keys are
  not hardcoded anywhere: `registerEnvFileKeys` in `server.ts` diffs `process.env` across
  the loader, so a credential added to `.env.local` later is scrubbed without anyone
  remembering to update a list. Covered at both ends — pure unit tests in
  `tests/server/childEnv.test.ts` and a real-tmux case in `tmux.integration.test.ts` that
  asserts a pane sees neither `NODE_ENV` nor a leaked key. Deliberately *not* extended to
  Mojito's own git/`gh`/`systemctl` calls, which no `NODE_ENV` branch touches.
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
  title width it needs there.
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
  codec — `parseLocation`/`formatLocation` over `/`, `/stacks`, `/session/<id>`,
  `/session/<id>/docs`, `/docs/ticket/<id>`, `/docs/session/<id>` plus the five filter
  params (`project` repeats — one parameter per selected project, since a project name
  is free text and could hold whatever separator a joined list picked) — and
  `useAppLocation` is the only `window.history` glue, so everything testable stays
  testable in the node-only vitest setup (no jsdom, no RTL; same split
  as `resolveInitialToken` ÷ `useToken`). The five `mojito-list-*` localStorage keys and
  `mojito-tab` are gone, along with `usePersistedState` itself: localStorage is shared
  between browser tabs, which is exactly what made two tabs unable to hold two filter
  sets. Consequences worth knowing: filters are serialized on *every* path, so leaving
  the list for the stacks panel and coming back does not drop them; defaults are
  omitted, so the unfiltered board is a bare `/` (and the PWA's `start_url` therefore
  always opens clean); typing in the filter box replaces the entry instead of pushing
  one per keystroke; and the page lives at `src/app/[[...view]]/page.tsx`, an optional
  catch-all, which is what makes a hard reload of `/stacks` serve the app instead of a
  404 — `/api/*` and `public/` still win as the more specific routes. That catch-all
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
- **Project filter**: the board's project filter offers *every configured project*, not
  only the ones its open tickets name (RIC-225) — `mergedProjects` unions
  `/api/projects` (`useProjects`) with the names the tickets and sessions on screen
  carry, so a project whose tickets are all closed is still reachable, and a ticket
  naming a project the map has dropped does not silently lose its option. It is a
  multi-select with a search box rather than a chip row: the list is now as long as
  projects.json, which a horizontally scrolling row cannot show, and "these two
  projects" is a state chips cannot express at all. So `ListFilters.project` is a
  `string[]` where `[]` means every project — `filterTickets`/`filterSessions` treat a
  non-empty set as OR — and `activeFilters` reports the whole set as one chip, since
  removing one project is what the select itself is for and a per-project ✕ would need
  `FilterKey` to carry a value. The status chips stay chips: five values that never grow.
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
- **Projects map**: `~/.config/mojito/projects.json` (Linear team key → project name →
  repo path), resolved by `resolveProjectsPath` in `src/server/config.ts`: env
  `MOJITO_PROJECTS` → `~/.config/mojito/projects.json`.

## Toolchain

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
  `npm run build && npm start` instead — production has no such restriction, and a dev
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
  `npm install` → stop → build → start, every time: the install is unconditional
  because a pull can bring a lockfile change and nothing in the supervisor watches for
  one, and on an unchanged tree it costs seconds — cheap next to serving a build whose
  dependencies are missing. Conditioning it was tried and dropped: neither "the manifests
  moved" (content hash) nor "the pulled commits touched them" (git diff) is worth the
  machinery when the answer is almost always yes and a needless install costs seconds.
  The install runs with the old server still up (a lockfile the registry cannot satisfy
  therefore aborts the cycle with the current build still live), and it is the only step
  the watchdog is held off for, since npm rewriting `node_modules` under the live server
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

`npx tsc --noEmit && npx vitest run` — server logic lives under `src/server/`, tests under
`tests/server/`. The tmux integration test is skipped when `tmux` is unavailable.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
