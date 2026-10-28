# Mojito rewrite — nucleo: piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una nuova app Mojito (Hono + SQLite + React/Vite) affiancata alla vecchia, che copre il nucleo: board dei ticket Linear per progetto, sessioni Claude Code in tmux con terminale xterm v6, creazione ticket via Agent SDK, sessioni libere, uso da telefono.

**Architecture:** Workspace pnpm con `apps/server` (un processo Hono: REST, due WebSocket gestiti con `ws` sull'`upgrade` del server http, statico della build web), `apps/web` (React 19 + Vite + Tailwind v4 + shadcn/ui) e `packages/shared` (tipi e schemi zod). SQLite (`better-sqlite3`) tiene progetti, impostazioni, sessioni e task SDK; i ticket stanno solo in una cache in memoria alimentata da Linear. Le sessioni girano in tmux e sopravvivono al riavvio; lo stato live arriva dagli hook di Claude Code.

**Tech Stack:** Node 22, TypeScript strict ESM, Hono 4 + `@hono/node-server`, `ws`, `node-pty`, `better-sqlite3`, `zod`, `@anthropic-ai/claude-agent-sdk`, React 19, Vite, Tailwind v4 (`@tailwindcss/vite`), shadcn/ui (Radix), `react-router` 7, TanStack Query 5, `@xterm/xterm` 6 + `@xterm/addon-fit`, `lucide-react`, vitest.

**Spec:** `docs/superpowers/specs/2026-10-28-mojito-rewrite-core-design.md`

## Global Constraints

- Il codice esistente (`src/`, `server.ts`, `tests/`, config Next) **non si tocca**, salvo `pnpm-workspace.yaml`, `package.json` root (script) e `tests/repo/packaging.test.ts` (Task 1).
- Porta di default `3100` (`MOJITO_PORT`), host `MOJITO_HOST` (default `0.0.0.0`).
- State dir `~/.local/state/mojito2` (`MOJITO_STATE_DIR` la sovrascrive); DB `<stateDir>/mojito.db`; hook settings in `<stateDir>/hooks/<id>.json`.
- Prefisso tmux `mj-`. Id: ticket `mj-<TICKET>`; libere `mj-<slug>-<hex6>` con `slug` = nome progetto in minuscolo, non-alfanumerici → `-`, oppure `general`.
- `LINEAR_API_KEY` e `MOJITO_TOKEN` solo da env / `<repoRoot>/.env.local`; mai nel DB, mai nell'env dei figli.
- Modelli: `opus`, `sonnet`, `haiku`, `fable` (la spec ne elenca tre; `fable` è aggiunto perché l'app attuale lo offre). Effort: `low`, `medium`, `high`, `xhigh`, `max`. Default per ogni stato: `{ model: "opus", effort: "high" }`; brainstorming di default `false`.
- Stati sessione: `starting`, `running`, `needs-input`, `idle`, `ended`. Kind: `ticket`, `claude`, `shell`.
- Ordine stati sulla board: `In Review`, `In Progress`, `Todo`, poi `Backlog` raccolto e chiuso di default.
- Ticket id validi: `/^[A-Z][A-Z0-9]*-\d+$/`.
- Immagini per "crea ticket": tipi `image/png`, `image/jpeg`, `image/gif`, `image/webp`; max 10 immagini; max 10 MB ciascuna.
- Coda task SDK: concorrenza 2; modello `sonnet`; `settingSources: []`; `tools: []`; `allowedTools: ["mcp__mojito-linear__*"]`.
- Copia di interfaccia in italiano.
- Nessun processo figlio riceve `process.env` grezzo: sempre `spawnEnv()`.
- UI: solo Tailwind + componenti shadcn sotto `apps/web/src/components/ui`; icone `lucide-react` con prop `size`.

## Review Focus

1. **Path di progetto inesistente o relativo** — un lancio deve rispondere 400 `"project path not found: <path>"` invece di aprire tmux in una directory sbagliata; Settings rifiuta un path non assoluto. Test in Task 7 e Task 5.
2. **Doppio tap su Avvia** — due `POST /api/sessions` concorrenti per lo stesso ticket: uno 201, l'altro 409, mai due tmux né due righe. Test in Task 7.
3. **Linear giù** — un polling fallito conserva l'ultima lista e marca `stale`; un primo polling fallito dà lista vuota con `error`, mai un crash del server. Test in Task 6.
4. **Quoting del prompt e degli argomenti** — un apice in un path o in un valore finisce in `'\''`; un ticket id non valido è rifiutato con 400 prima di costruire il comando. Test in Task 7.
5. **Immagini fuori limite** — undici immagini, un PDF o un file da 11 MB: 400 con messaggio, nessun upload parziale su Linear. Test in Task 10.

---

## File Structure

```
pnpm-workspace.yaml                 + packages, + allowBuilds better-sqlite3
package.json                        + script v2:*
packages/shared/src/
  index.ts                          re-export
  models.ts                         MODELS, EFFORTS, SessionState, SessionKind, StatusDefault
  api.ts                            zod: LaunchTicketBody, LaunchFreeBody, SettingsBody, ProjectBody, StatusBody
  types.ts                          TicketSummary, SessionMeta, TaskRecord, ProjectRow, Settings, BoardTickets
  events.ts                         MojitoEvent
apps/server/src/
  main.ts                           bootstrap: env, db, reconcile, poller, http, ws upgrade
  config.ts                         loadConfig()
  env/childEnv.ts                   porting di src/server/childEnv.ts
  db/db.ts                          openDb(), migrate()
  db/migrations/001_init.sql
  db/projects.ts                    ProjectsRepo + importProjectsJson()
  db/settings.ts                    SettingsRepo
  db/sessions.ts                    SessionsRepo
  db/tasks.ts                       TasksRepo
  events/bus.ts                     EventBus
  linear/client.ts                  LinearClient
  tickets/cache.ts                  TicketCache (poll + refresh)
  tmux/tmux.ts                      porting ridotto di src/server/tmux.ts
  sessions/hookSettings.ts          buildHookSettings()
  sessions/hookMap.ts               mapHook()
  sessions/startupStall.ts          watchStartupStall()
  sessions/prompt.ts                buildTicketPrompt()
  sessions/launch.ts                launchTicket(), launchFree()
  sessions/reconcile.ts             reconcileSessions()
  tasks/linearTools.ts              createLinearMcp()
  tasks/createTicket.ts             CREATE_TICKET_SYSTEM, buildCreateTicketMessage()
  tasks/runner.ts                   TaskQueue
  tasks/images.ts                   validateImages()
  ws/pty.ts                         attachPty() (porting)
  ws/events.ts                      attachEvents()
  http/app.ts                       createApp(deps)
  http/routes/*.ts                  una route per risorsa
apps/server/test/                   specchio di src/
apps/web/src/
  main.tsx, App.tsx, routes.tsx
  lib/api.ts                        apiFetch(), token
  lib/token.ts                      resolveInitialToken() (porting)
  lib/eventStream.ts                porting
  lib/board.ts                      groupBoard()
  lib/terminal/{terminalFit,keyboardInset,terminalText,composerHeight,touchScroll}.ts   porting
  hooks/{useEvents,useTickets,useSessions,useTasks,useProjects,useSettings}.ts
  components/ui/*                   shadcn
  components/board/{Board,ProjectSection,TicketCard,FreeSessionRow,TaskStrip,Toolbar}.tsx
  components/sheets/{TicketSheet,NewSessionSheet,NewTicketSheet}.tsx
  components/terminal/{TerminalPage,TerminalView,AccessoryBar,Composer,CopyBuffer}.tsx
  components/settings/SettingsPage.tsx
  components/TokenGate.tsx, StateBadge.tsx
apps/web/test/                      specchio di src/lib
deploy/mojito2.service
```

---

### Task 1: Scaffolding del workspace

**Files:**
- Modify: `pnpm-workspace.yaml`, `package.json`, `tests/repo/packaging.test.ts`
- Create: `packages/shared/{package.json,tsconfig.json,vitest.config.ts,src/index.ts}`, `apps/server/{package.json,tsconfig.json,vitest.config.ts,src/main.ts}`, `apps/web/{package.json,tsconfig.json,vite.config.ts,index.html,src/main.tsx}`, `tsconfig.base.json`
- Test: `apps/server/test/smoke.test.ts`

**Interfaces:**
- Produces: pacchetti `@mojito/shared`, `@mojito/server`, `@mojito/web`; script root `v2:dev`, `v2:build`, `v2:start`, `v2:test`, `v2:typecheck`.

- [ ] **Step 1:** `pnpm-workspace.yaml`: aggiungi `packages: ["apps/*", "packages/*"]` e `better-sqlite3: true` sotto `allowBuilds`; aggiorna il commento di testa (non è più "not a monorepo"). Il root resta un pacchetto (la vecchia app).
- [ ] **Step 2:** Crea i tre `package.json` (`"type": "module"`, `private`), con `@mojito/shared` come dipendenza `workspace:*` di server e web. Server: `hono`, `@hono/node-server`, `ws`, `node-pty`, `better-sqlite3`, `zod`, `@anthropic-ai/claude-agent-sdk`; dev `tsx`, `tsup`, `vitest`, `@types/ws`, `@types/better-sqlite3`. Web: `react`, `react-dom`, `react-router`, `@tanstack/react-query`, `@xterm/xterm`, `@xterm/addon-fit`, `lucide-react`, `tailwindcss`, `@tailwindcss/vite`; dev `vite`, `@vitejs/plugin-react`, `vitest`.
- [ ] **Step 3:** Script del server: `dev` = `tsx watch src/main.ts`, `build` = `tsup src/main.ts --format esm --target node22 --external better-sqlite3 --external node-pty`, `start` = `node dist/main.js`, `test` = `vitest run`, `typecheck` = `tsc --noEmit`. Web: `dev` = `vite`, `build` = `vite build`, `test` = `vitest run`, `typecheck` = `tsc --noEmit`. Root: `v2:test` = `pnpm -r --filter "./apps/*" --filter "./packages/*" test`, analoghi per `typecheck`/`build`; `v2:dev` = `pnpm -r --parallel --filter "./apps/*" dev`; `v2:start` = `pnpm --filter @mojito/server start`.
- [ ] **Step 4:** `vite.config.ts`: plugin react + tailwind, `server.proxy` per `/api` (http) e `/ws` (`ws: true`) verso `http://127.0.0.1:3100`, `build.outDir` = `dist`.
- [ ] **Step 5:** Scrivi `apps/server/test/smoke.test.ts` che importa `@mojito/shared` ed esegue `expect(true).toBe(true)`; aggiungi a `tests/repo/packaging.test.ts` l'asserzione che `allowBuilds` contenga `better-sqlite3: true` e che `packages` includa `apps/*` e `packages/*`.
- [ ] **Step 6:** Run `pnpm install && pnpm v2:test && pnpm v2:typecheck && pnpm test tests/repo` — Expected: tutto PASS, un solo lockfile.
- [ ] **Step 7:** Commit `chore(v2): scaffold pnpm workspace for the rewrite`.

---

### Task 2: Tipi condivisi

**Files:**
- Create: `packages/shared/src/{models,api,types,events}.ts`
- Test: `packages/shared/test/api.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const MODELS = ["opus","sonnet","haiku","fable"] as const; export type Model = typeof MODELS[number];
  export const EFFORTS = ["low","medium","high","xhigh","max"] as const; export type Effort = typeof EFFORTS[number];
  export type SessionState = "starting"|"running"|"needs-input"|"idle"|"ended";
  export type SessionKind = "ticket"|"claude"|"shell";
  export interface StatusDefault { model: Model; effort: Effort }
  export interface Settings { statusDefaults: Record<string, StatusDefault>; brainstormingDefault: boolean }
  export interface ProjectRow { name: string; path: string; teamKey: string }
  export interface TicketSummary { identifier; title; url; statusName; statusType; project: string|null; labels: string[]; assignedToMe: boolean }
  export interface BoardTickets { tickets: TicketSummary[]; fetchedAt: number|null; stale: boolean; error: string|null }
  export interface SessionMeta { id; kind: SessionKind; project: string|null; ticket: string|null; cwd; model: Model|null; effort: Effort|null; brainstorming: boolean; state: SessionState; alert: string|null; createdAt: number; lastEventAt: number }
  export type TaskStatus = "queued"|"running"|"done"|"failed";
  export interface TaskRecord { id; type: "create-ticket"; input: { project: string; note: string; imageUrls: string[] }; status: TaskStatus; log: string[]; error: string|null; result: { identifier: string; url: string }|null; archived: boolean; createdAt: number; updatedAt: number }
  export type MojitoEvent = { type: "session.updated"; session: SessionMeta } | { type: "session.removed"; id: string } | { type: "task.updated"; task: TaskRecord } | { type: "tickets.changed" };
  // zod
  export const LaunchTicketBody = z.object({ kind: z.literal("ticket"), ticket: z.string().regex(/^[A-Z][A-Z0-9]*-\d+$/), model: z.enum(MODELS), effort: z.enum(EFFORTS), brainstorming: z.boolean() });
  export const LaunchFreeBody = z.object({ kind: z.enum(["claude","shell"]), project: z.string().nullable(), model: z.enum(MODELS).optional(), effort: z.enum(EFFORTS).optional() });
  export const LaunchBody = z.discriminatedUnion("kind", [LaunchTicketBody, LaunchFreeBody]);
  export const ProjectBody = z.object({ name: z.string().min(1), path: z.string().startsWith("/"), teamKey: z.string().regex(/^[A-Z][A-Z0-9]*$/) });
  export const SettingsBody = z.object({ statusDefaults: z.record(z.object({ model: z.enum(MODELS), effort: z.enum(EFFORTS) })), brainstormingDefault: z.boolean() });
  export const StatusBody = z.object({ status: z.string().min(1) });
  ```
  `LaunchFreeBody` richiede `model` ed `effort` quando `kind === "claude"` (`superRefine`).

- [ ] **Step 1:** Test: `LaunchTicketBody` accetta `{kind:"ticket",ticket:"RIC-12",model:"opus",effort:"high",brainstorming:true}` e rifiuta `ticket:"ric-12"` e `ticket:"RIC-12; rm -rf"`; `LaunchBody` con `{kind:"claude",project:null}` fallisce, `{kind:"shell",project:null}` passa; `ProjectBody` rifiuta `path:"code/x"`.
- [ ] **Step 2:** Run `pnpm --filter @mojito/shared test` — Expected: FAIL (moduli mancanti).
- [ ] **Step 3:** Implementa i quattro file come da Interfaces.
- [ ] **Step 4:** Run lo stesso comando — Expected: PASS.
- [ ] **Step 5:** Commit `feat(v2/shared): types, schemas and events`.

---

### Task 3: Config, ambiente dei figli, tmux

**Files:**
- Create: `apps/server/src/config.ts`, `apps/server/src/env/childEnv.ts`, `apps/server/src/tmux/tmux.ts`
- Test: `apps/server/test/config.test.ts`, `apps/server/test/env/childEnv.test.ts` (porting di `tests/server/childEnv.test.ts`), `apps/server/test/tmux/tmux.test.ts`, `apps/server/test/tmux/tmux.integration.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ServerConfig { port: number; host: string; token: string; linearApiKey: string; stateDir: string; repoRoot: string; projectsJsonPath: string; home: string }
  export function loadConfig(env?: NodeJS.ProcessEnv): ServerConfig        // throws se manca MOJITO_TOKEN o LINEAR_API_KEY
  export function loadEnvFile(path: string): void                           // registerEnvFileKeys + util.parseEnv; no-op se il file manca
  // childEnv.ts: stesse esportazioni di src/server/childEnv.ts
  // tmux.ts:
  export const PREFIX = "mj-";
  export function q(s: string): string                                      // single-quote shell
  export function hasSession(name: string): Promise<boolean>
  export function newSession(name: string, cwd: string, command: string, deps?: Partial<SpawnDeps>): Promise<void>
  export function listSessions(prefix: string): Promise<string[]>
  export function closeSession(name: string, deps?: Partial<CloseDeps>, timeoutMs?: number, pollMs?: number): Promise<{ closed: boolean }>
  export function outsideService(args: string[], env: EnvLike): [string, string[]]
  export class DuplicateSessionError extends Error {}
  ```

- [ ] **Step 1:** Porta `childEnv.ts` e il suo test senza cambiare comportamento (solo import). Porta da `src/server/tmux.ts` `hasSession`, `newSession`, `parseGlobalEnvironment`, `globalEnvironment`, `outsideService`, `sendKeys`, `closeSession`, `listSessions` con i commenti; niente stack/pipe-pane/capture. Il `quoteArg` della vecchia app (cerca `q(` in `src/server/launch.ts`) diventa `q()` qui.
- [ ] **Step 2:** Test nuovi: `q("it's")` → `'it'\''s'`; `newSession` con `exec` finto che rigetta con stderr `duplicate session: mj-RIC-1` lancia `DuplicateSessionError`; `loadConfig({})` lancia; `loadConfig` con le due chiavi produce `port 3100`, `stateDir` = `<home>/.local/state/mojito2`, `projectsJsonPath` = `MOJITO_PROJECTS` o `<home>/.config/mojito/projects.json`. Test d'integrazione (`describe.skipIf(!tmuxAvailable())`): crea `mj-test-<rand>` con `sh -c 'trap "" INT; read x'`, `hasSession` true; `closeSession` con `timeoutMs 1500` restituisce `{closed:false}` e la sessione resta; poi `tmux kill-session` in `afterEach`. Un secondo caso con `cat`: `closeSession` → `{closed:true}`.
- [ ] **Step 3:** Run `pnpm --filter @mojito/server test` — Expected: FAIL sui nuovi test.
- [ ] **Step 4:** Implementa `config.ts` (con `util.parseEnv` di Node), `DuplicateSessionError` in `newSession` (match su `/duplicate session/`).
- [ ] **Step 5:** Run — Expected: PASS.
- [ ] **Step 6:** Commit `feat(v2/server): config, child env sanitizing, tmux helpers`.

---

### Task 4: Database e repository

**Files:**
- Create: `apps/server/src/db/{db.ts,projects.ts,settings.ts,sessions.ts,tasks.ts}`, `apps/server/src/db/migrations/001_init.sql`
- Test: `apps/server/test/db/*.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Db = import("better-sqlite3").Database;
  export function openDb(file: string): Db            // ":memory:" nei test; WAL; foreign_keys on; esegue migrate()
  export function migrate(db: Db): void                // tabella schema_migrations(version); applica i .sql in ordine
  export class ProjectsRepo { list(): ProjectRow[]; get(name): ProjectRow|null; upsert(p: ProjectRow): void; rename(old: string, p: ProjectRow): void; remove(name): void; isEmpty(): boolean }
  export function importProjectsJson(repo: ProjectsRepo, path: string): number   // righe importate; 0 se file assente/malformato
  export class SettingsRepo { get(): Settings; set(s: Settings): void }          // default dai Global Constraints, per gli stati Backlog/Todo/In Progress/In Review
  export class SessionsRepo { list(): SessionMeta[]; get(id): SessionMeta|null; insert(m: SessionMeta): void; patch(id, p: Partial<Pick<SessionMeta,"state"|"alert"|"lastEventAt">>): SessionMeta|null; remove(id): void; liveForTicket(ticket): SessionMeta|null }
  export class TasksRepo { list(): TaskRecord[]; get(id): TaskRecord|null; insert(t: TaskRecord): void; update(id, p: Partial<TaskRecord>): TaskRecord|null; appendLog(id, line: string): TaskRecord|null; failInterrupted(now: number): number }
  ```
  Schema: tabelle della spec; colonne JSON come `TEXT`; `sessions.id` PK; `sdk_tasks.archived INTEGER DEFAULT 0`. `liveForTicket` = sessione `kind='ticket'` con quel ticket e `state != 'ended'`. `failInterrupted` porta `queued`/`running` a `failed` con `error = "interrotto dal riavvio"`.

- [ ] **Step 1:** Test: migrate due volte non fallisce e `schema_migrations` ha una riga; `importProjectsJson` su un file con `{"RIC": {"path":"/a","projects":{"Web":"/w","Api":"/x"}}, "OPS": "/o"}` produce `Web/RIC`, `Api/RIC`, `OPS/OPS`; su file assente → 0; `SettingsRepo.get()` su DB vuoto → `statusDefaults["Todo"]` = `{model:"opus",effort:"high"}`, `brainstormingDefault:false`; `SessionsRepo` insert/patch/remove/`liveForTicket` (una `ended` non conta); `TasksRepo.appendLog` accoda, `failInterrupted` tocca solo `queued`/`running`.
- [ ] **Step 2:** Run — Expected: FAIL.
- [ ] **Step 3:** Implementa. La migrazione SQL va copiata in `dist` dal build: in `tsup` usa `--loader .sql=text` e importa i file con `import init from "./migrations/001_init.sql"` (tipizza con un `declare module "*.sql"`).
- [ ] **Step 4:** Run — Expected: PASS.
- [ ] **Step 5:** Commit `feat(v2/server): sqlite schema and repositories`.

---

### Task 5: Linear client

**Files:**
- Create: `apps/server/src/linear/client.ts`
- Test: `apps/server/test/linear/client.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export class LinearClient {
    constructor(apiKey: string, fetchImpl?: typeof fetch)
    listOpenIssues(projects: string[]): Promise<TicketSummary[]>
    listTeamStates(teamKey: string): Promise<string[]>                 // nomi in ordine di position
    setStatus(identifier: string, stateName: string): Promise<void>
    assignToMe(identifier: string): Promise<void>
    uploadImage(file: { filename: string; contentType: string; size: number; bytes: Uint8Array }): Promise<string>
    listLabels(teamKey: string): Promise<{ id: string; name: string }[]>
    createIssue(input: { teamKey: string; project: string; title: string; description: string; labelId?: string }): Promise<{ identifier: string; url: string }>
  }
  ```
  `listOpenIssues`, `setStatus`, `assignToMe`, `uploadImage`: porting di `listOpenIssues`/`setIssueStatus`/`setIssueAssignee(…, true)`/`uploadImage` di `src/server/linear.ts`, incluso il caso `projects = []` che non filtra. `createIssue` risolve team per `key` e project per nome dentro il team (`team.projects(filter:{name:{eq}})`), poi `issueCreate`; un project non trovato lancia `project "<name>" not found in team <key>`.

- [ ] **Step 1:** Test con `fetch` finto che registra i body: `listOpenIssues(["Web"])` invia `variables.projects = ["Web"]` e mappa i nodi come la vecchia app; `listOpenIssues([])` non dichiara variabili; `setStatus` su uno stato inesistente lancia `workflow state "Foo" not found in team`; `createIssue` invia `issueCreate` con `teamId`, `projectId`, `labelIds: ["L1"]` quando `labelId` c'è, senza `labelIds` quando manca; HTTP 500 → `Linear API error: 500`; risposta con `errors` → `Linear GraphQL error`.
- [ ] **Step 2:** Run — Expected: FAIL.
- [ ] **Step 3:** Implementa.
- [ ] **Step 4:** Run — Expected: PASS.
- [ ] **Step 5:** Commit `feat(v2/server): Linear GraphQL client`.

---

### Task 6: Event bus e cache dei ticket

**Files:**
- Create: `apps/server/src/events/bus.ts`, `apps/server/src/tickets/cache.ts`
- Test: `apps/server/test/tickets/cache.test.ts`, `apps/server/test/events/bus.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export class EventBus { subscribe(fn: (e: MojitoEvent) => void): () => void; emit(e: MojitoEvent): void }   // un listener che lancia non ferma gli altri
  export const POLL_MS = 45_000;
  export class TicketCache {
    constructor(deps: { linear: Pick<LinearClient,"listOpenIssues">; projects: () => string[]; bus: EventBus; now?: () => number })
    snapshot(): BoardTickets
    refresh(): Promise<void>        // coalescente: chiamate durante un refresh in corso attendono lo stesso
    start(): void; stop(): void     // setInterval(POLL_MS)
    get(identifier: string): TicketSummary | null
  }
  ```
  Successo: `tickets` sostituiti, `fetchedAt = now()`, `stale=false`, `error=null`, `emit({type:"tickets.changed"})` solo se la lista è cambiata (confronto JSON). Fallimento: `tickets` invariati, `stale = fetchedAt !== null`, `error = err.message`, `emit` se `stale`/`error` sono cambiati.

- [ ] **Step 1:** Test: refresh ok → snapshot con i ticket e un evento; secondo refresh identico → nessun evento; refresh che fallisce dopo un successo → stessi ticket, `stale:true`, `error:"boom"`; primo refresh che fallisce → `tickets:[]`, `stale:false`, `error:"boom"`; due `refresh()` concorrenti → `listOpenIssues` chiamato una volta; bus: un listener che lancia non impedisce al secondo di ricevere.
- [ ] **Step 2:** Run — Expected: FAIL.
- [ ] **Step 3:** Implementa.
- [ ] **Step 4:** Run — Expected: PASS.
- [ ] **Step 5:** Commit `feat(v2/server): event bus and ticket cache`.

---

### Task 7: Lancio delle sessioni e prompt

**Files:**
- Create: `apps/server/src/sessions/{prompt.ts,hookSettings.ts,launch.ts,startupStall.ts}`
- Test: `apps/server/test/sessions/{prompt,hookSettings,launch,startupStall}.test.ts`

**Interfaces:**
- Consumes: `SessionsRepo`, `ProjectsRepo`, `EventBus`, `LinearClient`, `TicketCache`, `newSession`, `q`, `DuplicateSessionError`.
- Produces:
  ```ts
  export function buildTicketPrompt(ticket: string, brainstorming: boolean): string
  export function buildHookSettings(sessionId: string, port: number, token: string): { hooks: Record<string, unknown[]> }   // porting
  export const STALL_GRACE_MS = 20_000;
  export function watchStartupStall(id: string, deps: { sessions: SessionsRepo; bus: EventBus; hasSession(n: string): Promise<boolean>; setTimeout?: typeof setTimeout }): void
  export interface LaunchDeps { cfg: ServerConfig; sessions: SessionsRepo; projects: ProjectsRepo; bus: EventBus; linear: Pick<LinearClient,"setStatus"|"assignToMe">; tickets: TicketCache; newSession: typeof newSession; exists(path: string): boolean; writeFile(path: string, data: string): void; now(): number; randomHex(): string }
  export type LaunchResult = { ok: true; session: SessionMeta; warning?: string } | { ok: false; status: 400|404|409; error: string; sessionId?: string };
  export function launchTicket(body: LaunchTicketBody, deps: LaunchDeps): Promise<LaunchResult>
  export function launchFree(body: LaunchFreeBody, deps: LaunchDeps): Promise<LaunchResult>
  ```

- [ ] **Step 1: Test del prompt** — testo esatto, copiato dalla spec:
  ```ts
  expect(buildTicketPrompt("RIC-123", false)).toBe(
    'Leggi il ticket RIC-123 da Linear ed eseguilo.\nQuando il lavoro è pronto per la revisione, sposta il ticket in "In Review" su Linear.');
  expect(buildTicketPrompt("RIC-123", true)).toBe(
    'Leggi il ticket RIC-123 da Linear ed eseguilo.\nPrima di implementare, usa la skill superpowers:brainstorming.\nQuando il lavoro è pronto per la revisione, sposta il ticket in "In Review" su Linear.');
  ```
- [ ] **Step 2: Test di `launchTicket`** con deps finte (ticket `RIC-1` in cache con `project: "Web"`, progetto `Web` → `/repo/web`):
  - successo: `newSession("mj-RIC-1", "/repo/web", cmd)` con `cmd` = `claude --model 'opus' --effort 'high' --settings '<stateDir>/hooks/mj-RIC-1.json' '<prompt>'` (prompt passato in `q()`); hook settings scritte in quel path; riga sessione `starting`, `kind:"ticket"`; evento `session.updated`; `setStatus("RIC-1","In Progress")` e `assignToMe("RIC-1")` chiamati; `tickets.refresh()` chiamato.
  - `setStatus` che lancia → `ok:true` con `warning:"Stato su Linear non aggiornato: <msg>"`.
  - ticket non in cache → 404; progetto non mappato → 400 `"project not mapped: <name>"`; `exists("/repo/web") === false` → 400 `"project path not found: /repo/web"`, nessun `newSession`.
  - sessione viva in DB per `RIC-1` → 409 con `sessionId:"mj-RIC-1"`, nessun `newSession`.
  - `newSession` che lancia `DuplicateSessionError` → 409 con `sessionId`, nessuna riga inserita.
  - due `launchTicket` concorrenti con lo stesso body → esattamente un `ok:true` e un 409, `newSession` chiamato una volta (lock in memoria per id durante il lancio).
  - una riga `ended` per `mj-RIC-1` viene sostituita da quella nuova.
- [ ] **Step 3: Test di `launchFree`**: `kind:"claude", project:"Web"` → id `mj-web-<hex>`, cwd `/repo/web`, comando senza prompt; `project:null` → id `mj-general-<hex>`, cwd = `cfg.home`; `kind:"shell"` → comando `exec "${SHELL:-/bin/bash}" -l`, stato iniziale `running`, nessun hook settings, nessun `watchStartupStall`.
- [ ] **Step 4: Test di `watchStartupStall`**: dopo `STALL_GRACE_MS`, sessione ancora `starting` con tmux vivo → `needs-input` con `alert:"apri il terminale e rispondi"` + evento; sessione già `running` → nessun cambio; tmux sparito → nessun cambio.
- [ ] **Step 5:** Run — Expected: FAIL.
- [ ] **Step 6:** Implementa. `buildHookSettings`: porting di `src/server/hookSettings.ts` (URL `http://127.0.0.1:<port>/api/hook`). `launchTicket` chiama `watchStartupStall` dopo l'insert. Le scritture Linear avvengono dopo `newSession` e non ne bloccano il risultato.
- [ ] **Step 7:** Run — Expected: PASS.
- [ ] **Step 8:** Commit `feat(v2/server): ticket and free session launch`.

---

### Task 8: Hook, chiusura e riconciliazione

**Files:**
- Create: `apps/server/src/sessions/{hookMap.ts,hooks.ts,reconcile.ts,close.ts}`
- Test: `apps/server/test/sessions/{hookMap,hooks,reconcile,close}.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type HookEventName = "SessionStart"|"UserPromptSubmit"|"PermissionRequest"|"Notification"|"PreToolUse"|"PostToolUse"|"Stop"|"SessionEnd";
  export function mapHook(event: HookEventName, current: SessionState): { state: SessionState; alert: string|null }
  export function handleHook(id: string, event: string, deps: { sessions: SessionsRepo; bus: EventBus; tickets: TicketCache; now(): number }): void   // mai throw
  export function reconcileSessions(deps: { sessions: SessionsRepo; listTmux(): Promise<string[]>; bus: EventBus; now(): number }): Promise<{ ended: string[]; adopted: string[] }>
  export function kindFromId(id: string): SessionKind          // mj-<TICKET> → ticket; altrimenti claude
  export function killSession(id: string, deps: { sessions: SessionsRepo; bus: EventBus; closeSession: typeof closeSession }): Promise<{ status: 200|404|409 }>
  ```
  `mapHook` (tabella della spec): `SessionStart`/`UserPromptSubmit`/`PostToolUse` → `running`; `PermissionRequest` → `needs-input` "claude chiede un permesso"; `Notification` → `needs-input` "claude ti sta aspettando"; `PreToolUse` → `needs-input` "claude ti fa una domanda"; `Stop` → `idle`; `SessionEnd` → `ended`. `ended` è definitivo: nessun evento lo cambia. `handleHook` su `Stop` di una sessione `kind:"ticket"` chiama `tickets.refresh()` (senza attendere). Id sconosciuto o evento sconosciuto → ignorato. `reconcileSessions`: righe non-`ended` senza tmux → `ended` + evento; tmux `mj-*` senza riga → riga adottata (`state:"idle"`, `cwd:""`, `model/effort:null`, ticket ricavato dall'id per `kind:"ticket"`). `killSession`: id sconosciuto → 404; `closeSession` `{closed:false}` → 409 e nulla cambia; `{closed:true}` → `state:"ended"` + evento. Rimozione di una riga `ended` = `DELETE /api/sessions/:id?remove=1` (Task 9), che rifiuta con 409 una sessione non `ended`.

- [ ] **Step 1:** Test: ogni riga della tabella di `mapHook`; `ended` + `SessionStart` resta `ended`; `handleHook("mj-x","Stop")` con id sconosciuto non lancia e non emette; `Stop` su sessione ticket → `refresh` chiamato; `kindFromId("mj-RIC-12")` = `ticket`, `kindFromId("mj-web-ab12cd")` = `claude`; `reconcileSessions` con DB `{mj-RIC-1 running, mj-RIC-2 idle}` e tmux `[mj-RIC-1, mj-web-aa11bb]` → `ended:["mj-RIC-2"]`, `adopted:["mj-web-aa11bb"]`; i tre casi di `killSession`.
- [ ] **Step 2:** Run — Expected: FAIL.
- [ ] **Step 3:** Implementa. Una shell adottata viene classificata `claude` (non c'è altro da cui leggerlo); accettato.
- [ ] **Step 4:** Run — Expected: PASS.
- [ ] **Step 5:** Commit `feat(v2/server): hook mapping, kill and restart reconciliation`.

---

### Task 9: App HTTP, WebSocket e bootstrap

**Files:**
- Create: `apps/server/src/http/app.ts`, `apps/server/src/http/routes/{health,hook,projects,settings,tickets,sessions}.ts`, `apps/server/src/ws/{pty.ts,events.ts,upgrade.ts}`, `apps/server/src/main.ts`
- Test: `apps/server/test/http/*.test.ts`, `apps/server/test/ws/pty.test.ts` (porting di `tests/server/ptyGateway.test.ts`), `apps/server/test/ws/upgrade.test.ts`

**Interfaces:**
- Consumes: tutto ciò che producono i Task 3–8 (il runner dei task arriva nel Task 10 e si aggancia qui allora).
- Produces:
  ```ts
  export interface AppDeps { cfg; db; projects; settings; sessions; tasks; bus; linear; tickets; launch: LaunchDeps; closeSession; staticDir?: string }
  export function createApp(deps: AppDeps): Hono
  export function attachPty(ws: WebSocket, id: string, deps?: Partial<AttachDeps>): void          // porting
  export function attachEvents(ws: WebSocket, bus: EventBus): void                               // un JSON per evento; unsubscribe su close
  export function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, deps: { token: string; wss: WebSocketServer; sessions: SessionsRepo; bus: EventBus }): void
  ```
  Route (tutte sotto `/api`, token richiesto salvo `health`; `hook` vuole lo stesso token in `x-mojito-token`):
  | Metodo e path | Corpo / risposta |
  |---|---|
  | `GET /health` | `{ok:true}` |
  | `POST /hook?session=&event=` | 200 sempre, `handleHook` |
  | `GET /projects` · `POST /projects` · `PUT /projects/:name` · `DELETE /projects/:name` | `ProjectBody`; 400 su path non assoluto o inesistente (`exists`); 409 su nome duplicato |
  | `GET /settings` · `PUT /settings` | `SettingsBody` |
  | `GET /tickets` | `BoardTickets` |
  | `GET /tickets/states?team=` | `string[]` |
  | `POST /tickets/:id/status` | `StatusBody` → `setStatus` + `refresh`; 502 con messaggio su errore Linear |
  | `GET /sessions` | `SessionMeta[]` |
  | `POST /sessions` | `LaunchBody` → `LaunchResult` (201 / status) |
  | `DELETE /sessions/:id` | `killSession`; con `?remove=1` cancella una riga `ended` + `session.removed` |
  | `GET /*` (non `/api`, non `/ws`) | file da `staticDir`, fallback `index.html` |
  `handleUpgrade`: path `/ws/events` o `/ws/pty/<id>`, token in query `token`; altrimenti `socket.destroy()`.
  `main.ts`: `loadEnvFile(<repoRoot>/.env.local)` → `snapshotEnvKeys`/`registerEnvKeysAddedSince` attorno al load → `loadConfig` → `openDb` → `importProjectsJson` se vuoto → `tasks.failInterrupted` → `reconcileSessions` → `tickets.start()` → `serve({ fetch: app.fetch, port, hostname })` → `server.on("upgrade", handleUpgrade)`. `repoRoot` = due livelli sopra `apps/server`.

- [ ] **Step 1:** Test delle route con `app.request()` e SQLite in memoria: senza token → 401; `GET /health` senza token → 200; `POST /projects` con path relativo → 400; `POST /sessions` con `ticket:"x"` → 400; `POST /hook` con id sconosciuto → 200; `DELETE /sessions/:id?remove=1` su sessione `running` → 409; `GET /` con `staticDir` contenente `index.html` → 200 HTML; `GET /session/abc` → stesso `index.html`; `GET /api/nope` → 404 (non `index.html`).
- [ ] **Step 2:** Test `handleUpgrade`: token sbagliato → `socket.destroy` chiamato; `/ws/pty/` senza id → destroy.
- [ ] **Step 3:** Porta `ptyGateway.ts` e il suo test (incluso il replay `capturePane` all'attach se presente nell'originale e la guardia sul socket chiuso prima dello spawn).
- [ ] **Step 4:** Run — Expected: FAIL.
- [ ] **Step 5:** Implementa.
- [ ] **Step 6:** Run `pnpm --filter @mojito/server test` — Expected: PASS.
- [ ] **Step 7:** Verifica manuale: `MOJITO_PORT=3100 pnpm --filter @mojito/server dev`, poi `curl -s localhost:3100/api/health` → `{"ok":true}`; `curl -s -H "x-mojito-token: $MOJITO_TOKEN" localhost:3100/api/tickets` → JSON con i ticket.
- [ ] **Step 8:** Commit `feat(v2/server): http routes, websockets and bootstrap`.

---

### Task 10: Task SDK "crea ticket"

**Files:**
- Create: `apps/server/src/tasks/{images.ts,linearTools.ts,createTicket.ts,runner.ts}`, `apps/server/src/http/routes/tasks.ts`
- Modify: `apps/server/src/http/app.ts`, `apps/server/src/main.ts`
- Test: `apps/server/test/tasks/{images,linearTools,createTicket,runner}.test.ts`, `apps/server/test/http/tasks.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function validateImages(files: { name: string; type: string; size: number }[]): { ok: true } | { ok: false; error: string }
  export function createLinearMcp(linear: Pick<LinearClient,"listLabels"|"createIssue">, onCreated: (r: { identifier: string; url: string }) => void): McpSdkServerConfigWithInstance   // nome "mojito-linear", tool list_labels e create_issue
  export const CREATE_TICKET_SYSTEM: string
  export function buildCreateTicketMessage(input: { teamKey: string; project: string; note: string; imageUrls: string[] }, images: { mediaType: string; base64: string }[]): SDKUserMessage
  export type QueryFn = typeof import("@anthropic-ai/claude-agent-sdk").query;
  export class TaskQueue {
    constructor(deps: { tasks: TasksRepo; projects: ProjectsRepo; linear: LinearClient; bus: EventBus; tickets: TicketCache; query: QueryFn; fetchImage(url: string): Promise<{ mediaType: string; base64: string }>; concurrency?: number; now(): number })
    enqueue(id: string): void
    retry(id: string): boolean          // solo da failed; status → queued
  }
  ```
  Route: `GET /api/tasks` (non archiviati), `POST /api/tasks` (multipart: `project`, `note`, `images[]`) → `validateImages` → upload di tutte le immagini **prima** di inserire il task (fallisce tutto se un upload fallisce: 502, nessun task) → insert `queued` → `enqueue` → 201 `TaskRecord`; `POST /api/tasks/:id/retry`; `POST /api/tasks/:id/archive`.
  `query()` chiamato con `{ prompt: (async function*(){ yield message })(), options: { model: "sonnet", systemPrompt: CREATE_TICKET_SYSTEM, settingSources: [], tools: [], mcpServers: { "mojito-linear": mcp }, allowedTools: ["mcp__mojito-linear__*"], maxTurns: 10 } }`. Ogni messaggio `assistant` con testo → `appendLog` + `task.updated`; i tool use → riga di log `→ <nome tool>`. Esito: `done` se `onCreated` è stato chiamato, altrimenti `failed` con `error` = testo del `result` o `"nessun ticket creato"`. Eccezione → `failed` con il messaggio. Le immagini per il modello si scaricano da Linear con `Authorization: <apiKey>` (`fetchImage`).
  `CREATE_TICKET_SYSTEM` è l'adattamento di `INTAKE_PROMPT_TEMPLATE` (`src/server/prompts/intake.ts`) con queste differenze: input nel messaggio e non in un file; tool `list_labels`/`create_issue` invece del MCP Linear; l'ultimo paragrafo ("ask in this terminal") sostituito da "Non fare domande: se la nota è vaga, crea un ticket fedele a ciò che dice."; il paragrafo immagini (`INTAKE_IMAGES_PARAGRAPH`, adattato) solo nel messaggio e solo se `imageUrls` non è vuoto.

- [ ] **Step 1:** Test `validateImages`: 11 file → `"troppe immagini (max 10)"`; `application/pdf` → `"tipo non supportato: application/pdf"`; 10 MB + 1 byte → `"immagine troppo grande: <name>"`; 0 file → ok.
- [ ] **Step 2:** Test `buildCreateTicketMessage`: con `imageUrls: []` il testo non contiene `![](` né la parola "immagini"; con due URL contiene entrambi e due blocchi `image` base64.
- [ ] **Step 3:** Test `createLinearMcp`: invocando l'handler di `create_issue` chiama `linear.createIssue` e `onCreated` con `{identifier,url}`; l'handler restituisce testo con identifier e url.
- [ ] **Step 4:** Test `TaskQueue` con `query` finto (generatore che emette un `assistant` testo, invoca l'handler del tool `create_issue` presente in `options.mcpServers`, poi un `result`): stato `running` → `done`, `result` valorizzato, log non vuoto, `tickets.refresh` chiamato; `query` che lancia → `failed` con il messaggio; con 3 task e `concurrency:2` il terzo resta `queued` finché uno non finisce; `retry` su `done` → `false`; le opzioni passate a `query` contengono `settingSources: []`, `tools: []` e `allowedTools: ["mcp__mojito-linear__*"]`.
- [ ] **Step 5:** Test route: upload che fallisce → 502 e `tasks.list()` vuoto; PDF → 400 e nessun upload chiamato.
- [ ] **Step 6:** Run — Expected: FAIL.
- [ ] **Step 7:** Implementa; aggancia `TaskQueue` in `main.ts` dopo `failInterrupted`.
- [ ] **Step 8:** Run — Expected: PASS.
- [ ] **Step 9:** Verifica manuale con il server avviato: `curl -F project=<un progetto> -F note="prova da mojito2, ignorare" -H "x-mojito-token: $MOJITO_TOKEN" localhost:3100/api/tasks`, poi `GET /api/tasks` finché `status` è `done`; il ticket esiste su Linear (cancellalo dopo).
- [ ] **Step 10:** Commit `feat(v2/server): create-ticket task on the Agent SDK`.

---

### Task 11: Web — base, token, dati live

**Files:**
- Create: `apps/web/src/{main.tsx,App.tsx,routes.tsx,index.css}`, `apps/web/src/lib/{api.ts,token.ts,eventStream.ts}`, `apps/web/src/hooks/{useEvents,useTickets,useSessions,useTasks,useProjects,useSettings}.ts`, `apps/web/src/components/TokenGate.tsx`, `apps/web/components.json`, `apps/web/src/components/ui/*`
- Test: `apps/web/test/lib/{token,eventStream,api}.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function apiFetch<T>(path: string, init?: RequestInit): Promise<T>     // aggiunge x-mojito-token; su !ok lancia ApiError(status, body.error ?? statusText)
  export class ApiError extends Error { status: number; body: unknown }
  export function resolveInitialToken(...)                                       // porting di src/lib/resolveInitialToken.ts, chiave localStorage "mojito2-token"
  export function openEventStream(...)                                           // porting di src/lib/eventStream.ts
  export const qk = { tickets: ["tickets"], sessions: ["sessions"], tasks: ["tasks"], projects: ["projects"], settings: ["settings"] } as const;
  export function useEvents(): void      // in App: su connect invalida tutte le qk; su visibilitychange→visible invalida sessions e tasks; session.* → setQueryData su sessions; task.updated → setQueryData su tasks; tickets.changed → invalida tickets
  ```
  Tema: `index.css` con `@import "tailwindcss"`, token shadcn in `:root` e `.dark`, `html` con classe `dark` di default; token safe area `--sat/--sar/--sab/--sal` = `env(safe-area-inset-*, 0px)`. `index.html`: `viewport-fit=cover`, `apple-mobile-web-app-status-bar-style=black-translucent`, `lang="it"`.
  Componenti shadcn da aggiungere (con `pnpm dlx shadcn@latest add` in `apps/web`): `button`, `sheet`, `select`, `switch`, `badge`, `input`, `textarea`, `label`, `sonner`, `collapsible`, `dialog`, `card`.

- [ ] **Step 1:** Porta `resolveInitialToken` e `openEventStream` con i loro test (`tests/lib/resolveInitialToken.test.ts`, `tests/client/eventStream.test.ts`). Test nuovo: `apiFetch` con `fetch` finto che risponde 409 `{error:"x"}` lancia `ApiError` con `status 409` e `message "x"`.
- [ ] **Step 2:** Run `pnpm --filter @mojito/web test` — Expected: FAIL.
- [ ] **Step 3:** Implementa; `App` = `QueryClientProvider` + `TokenGate` + `RouterProvider` con le rotte `/`, `/session/:id`, `/settings` (pagine segnaposto per ora) + `<Toaster />`.
- [ ] **Step 4:** Run test e `pnpm --filter @mojito/web typecheck` — Expected: PASS.
- [ ] **Step 5:** Verifica: `pnpm v2:dev`, apri `http://localhost:5173/?token=$MOJITO_TOKEN`, il token sparisce dall'url, la pagina segnaposto della board si vede, in devtools `/ws/events` è connesso.
- [ ] **Step 6:** Commit `feat(v2/web): app shell, token gate and live data`.

---

### Task 12: Web — board

**Files:**
- Create: `apps/web/src/lib/board.ts`, `apps/web/src/components/board/{Board,Toolbar,TaskStrip,ProjectSection,TicketCard,FreeSessionRow}.tsx`, `apps/web/src/components/StateBadge.tsx`
- Test: `apps/web/test/lib/board.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const STATUS_ORDER = ["In Review","In Progress","Todo"];
  export interface BoardSection { project: string | null; active: TicketSummary[]; backlog: TicketSummary[]; free: SessionMeta[] }
  export function groupBoard(projects: ProjectRow[], tickets: TicketSummary[], sessions: SessionMeta[]): BoardSection[]
  export function sessionForTicket(sessions: SessionMeta[], identifier: string): SessionMeta | null   // non-ended preferita, altrimenti la più recente
  export function needsInput(sessions: SessionMeta[]): SessionMeta[]                                   // ordinate per lastEventAt crescente
  ```
  `groupBoard`: una sezione per progetto in `projects` (ordine alfabetico), anche senza ticket se ha sessioni libere; sezione `project:null` ("General") in coda solo se ha sessioni libere; `active` ordinato per `STATUS_ORDER` poi `identifier` numerico; stati non in `STATUS_ORDER` e non `Backlog` (es. Triage) dopo `Todo`; `free` = sessioni `kind != "ticket"` del progetto, ordinate per `createdAt` decrescente. Sezioni vuote (nessun ticket, nessuna libera) omesse.
  UI: `Toolbar` sticky con padding `pt-[var(--sat)]`: titolo, "+ Ticket", "+ Sessione", pill ambra con `needsInput().length` (tocco → `/session/<primo>`), icona Settings. `TaskStrip`: card per task non archiviato con stato, log collassabile (`Collapsible`), link al ticket, "Riprova" sui `failed`, ✕ → archive. Banner `stale`/`error` dei ticket: "Linear non raggiungibile — dati delle HH:MM" o "Linear non raggiungibile: <error>". `TicketCard`: id come `<a href={url} target="_blank">` fuori dalla zona cliccabile della card, badge stato, titolo, label, `StateBadge` della sessione. Tocco card → apre `TicketSheet` (Task 13). `FreeSessionRow` → naviga a `/session/<id>`; una sessione `ended` mostra "Rimuovi".

- [ ] **Step 1:** Test `groupBoard`: ordine In Review → In Progress → Todo; `RIC-9` prima di `RIC-10`; Backlog separato; progetto senza ticket ma con sessione libera presente; sessione libera `project:null` → sezione General in coda; progetto senza nulla omesso. Test `sessionForTicket`: con una `ended` più recente e una `idle` più vecchia restituisce la `idle`. Test `needsInput`.
- [ ] **Step 2:** Run — Expected: FAIL.
- [ ] **Step 3:** Implementa `board.ts` e i componenti.
- [ ] **Step 4:** Run test + typecheck — Expected: PASS.
- [ ] **Step 5:** Verifica con `pnpm v2:dev`: i ticket reali compaiono per progetto, Backlog chiuso, a 390px di larghezza nessuno scroll orizzontale (devtools, iPhone 12 Pro).
- [ ] **Step 6:** Commit `feat(v2/web): board`.

---

### Task 13: Web — sheet ticket, nuova sessione, nuovo ticket

**Files:**
- Create: `apps/web/src/components/sheets/{TicketSheet,NewSessionSheet,NewTicketSheet}.tsx`, `apps/web/src/lib/launch.ts`
- Test: `apps/web/test/lib/launch.test.ts`

**Interfaces:**
- Consumes: `apiFetch`, `qk`, `Settings`, `LaunchBody`.
- Produces:
  ```ts
  export function initialLaunchOptions(ticket: TicketSummary, settings: Settings): { model: Model; effort: Effort; brainstorming: boolean }   // statusDefaults[statusName] ?? {opus, high}
  export function launchErrorAction(err: ApiError): { kind: "open"; sessionId: string } | { kind: "toast"; message: string }                // 409 con sessionId → open
  ```
  `TicketSheet`: header con id (link) e titolo; se `sessionForTicket` è viva → "Apri terminale" + "Kill" (con `confirm`), altrimenti selettori Modello/Effort (`Select`), `Switch` Brainstorming, "Avvia" → `POST /api/sessions` → naviga a `/session/<id>`; `warning` → toast. Selettore di stato (`Select` con `GET /api/tickets/states?team=<teamKey del progetto>`) → `POST /api/tickets/:id/status`, ottimistico con rollback e toast su errore. Kill che risponde 409 → toast "claude non si è chiuso: apri il terminale".
  `NewSessionSheet`: Progetto (`Select`: progetti + "General"), Tipo (`claude`/`shell`), Modello/Effort solo per `claude` (default `statusDefaults["In Progress"]`) → `POST /api/sessions` → naviga.
  `NewTicketSheet`: Progetto (preselezionato se l'utente ha aperto il sheet da una sezione — prop `project?`), `Textarea` nota, immagini da file input, incolla (`paste` con `clipboardData.files`) e drop; anteprime con ✕; validazione lato client con gli stessi limiti; "Crea" → `POST /api/tasks` multipart → chiude e mostra toast "Ticket in creazione".

- [ ] **Step 1:** Test: `initialLaunchOptions` per `Todo` con settings personalizzati; stato sconosciuto → `{opus, high, brainstorming: settings.brainstormingDefault}`; `launchErrorAction(new ApiError(409, …, {sessionId:"mj-RIC-1"}))` → open; 400 → toast con il messaggio.
- [ ] **Step 2:** Run — Expected: FAIL.
- [ ] **Step 3:** Implementa.
- [ ] **Step 4:** Run test + typecheck — Expected: PASS.
- [ ] **Step 5:** Verifica: lancia un ticket di prova, la board mostra la sessione `starting` → `running`; il ticket passa In Progress su Linear; crea un ticket con un'immagine incollata e vedi il task arrivare a `done`.
- [ ] **Step 6:** Commit `feat(v2/web): ticket, new session and new ticket sheets`.

---

### Task 14: Web — terminale

**Files:**
- Create: `apps/web/src/lib/terminal/{terminalFit,keyboardInset,touchScroll,platform}.ts`, `apps/web/src/components/terminal/{TerminalPage,TerminalView}.tsx`, `apps/web/src/hooks/useKeyboardOpen.ts`
- Test: porting di `tests/client/{terminalFit,keyboardInset,keyboardOpen,touchScroll}.test.ts` in `apps/web/test/lib/terminal/`; nuovo `apps/web/test/lib/terminal/platform.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // porting invariato: isUsableGeometry, syncGeometry, termRootStyle, isKeyboardOpen, KEYBOARD_MIN_INSET, computeTouchScroll, wheelSequences
  export function detectPlatform(nav: { platform?: string; userAgent: string }): { isMac: boolean; isWindows: boolean; isFirefox: boolean }
  export function xtermThinksItIsNode(): boolean        // importa @xterm/xterm nel bundle Vite e legge il flag (vedi Step 4)
  export function TerminalView(props: { sessionId: string; onExit(): void }): JSX.Element
  ```
  `TerminalView`: `new Terminal({ ...opzioni di src/lib/terminalOptions.ts senza WebGL })`, `FitAddon`, WebSocket `/ws/pty/<id>?token=…` binario per i tasti e JSON `{resize:{cols,rows}}` per la geometria, `syncGeometry` su `ResizeObserver`/`visualViewport`/apertura socket, reconnect ogni 1.5 s finché la pagina è montata, touch scroll come in `src/components/TerminalView.tsx`. `TerminalPage`: header (← Board, id + titolo + stato ticket o "<kind> · <progetto>", `StateBadge`, Kill), nascosto con tastiera aperta; `.term-root` paga `--sat` e ha `background` della superficie; il corpo è ancorato in basso.

- [ ] **Step 1:** Porta i quattro moduli puri e i loro test senza modifiche di comportamento.
- [ ] **Step 2:** Test `detectPlatform`: `MacIntel` → `isMac`; `Win32` → `isWindows`; UA Firefox → `isFirefox`.
- [ ] **Step 3:** Run — Expected: FAIL sui nuovi.
- [ ] **Step 4:** Implementa. Poi verifica la questione `restoreTerminalPlatform`: in dev, in console su un Mac, `term._core.browser.isMac` (o equivalente letto in `src/lib/terminalPlatform.ts`) deve essere `true`. Se è `false`, porta `restoreTerminalPlatform` e il suo test da `src/lib/terminalPlatform.ts` / `tests/client/terminalPlatform.test.ts` e chiamalo dopo `term.open()`; annota l'esito nel messaggio di commit. In ogni caso verifica `Option+ò` → `@` su layout italiano.
- [ ] **Step 5:** Run test + typecheck — Expected: PASS.
- [ ] **Step 6:** Verifica: apri una sessione dalla board, scrivi, ridimensiona la finestra (claude si ridisegna), riavvia il server (`Ctrl-C` + `pnpm v2:dev`): il terminale si riconnette e la sessione tmux è ancora lì.
- [ ] **Step 7:** Commit `feat(v2/web): terminal view`.

---

### Task 15: Web — accessory bar, composer, copia

**Files:**
- Create: `apps/web/src/lib/terminal/{terminalText,composerHeight}.ts`, `apps/web/src/components/terminal/{AccessoryBar,Composer,CopyBuffer}.tsx`
- Test: porting di `tests/client/{terminalText,composerHeight}.test.ts`

**Interfaces:**
- Produces: `bufferText(buffer: BufferLike): string`, `composerHeight(...)` (porting invariato); `AccessoryBar({ term, onCompose, onCopy })`.
  Tasti, in quest'ordine: composer (`SquarePen`), `↑ ↓ ← → ⏎ ⇧⏎ Esc Tab ⇧Tab ^C`, copia (`Copy`) — stesse sequenze di `src/components/AccessoryBar.tsx`. Visibile solo con `(pointer: coarse)`. Paga `--sab` salvo con tastiera aperta. `Composer`: `<textarea>` con altezza da `composerHeight`, "Inserisci" → `term.paste(text)` senza CR, poi svuota e chiude. `CopyBuffer`: overlay `<pre>` selezionabile con `bufferText(term.buffer.active)`, snapshot all'apertura, ✕ per chiudere.

- [ ] **Step 1:** Porta i due moduli puri con i test.
- [ ] **Step 2:** Run — Expected: PASS sui test portati (verifica che girino davvero: `--reporter verbose`).
- [ ] **Step 3:** Implementa i tre componenti e montali in `TerminalPage`.
- [ ] **Step 4:** Verifica da iPhone (server in `pnpm v2:build && pnpm v2:start`, raggiunto via LAN o Tailscale con `?token=`): tasti freccia ed Esc funzionano in claude; il composer inietta il testo dettato una volta sola; la copia del buffer permette "Copia" nativo; con tastiera aperta la riga di input di claude resta visibile e l'header sparisce.
- [ ] **Step 5:** Commit `feat(v2/web): accessory bar, composer and buffer copy`.

---

### Task 16: Web — Settings e safe area

**Files:**
- Create: `apps/web/src/components/settings/SettingsPage.tsx`
- Test: `apps/web/test/safeArea.test.ts`

**Interfaces:**
- Consumes: `GET/POST/PUT/DELETE /api/projects`, `GET/PUT /api/settings`.
- Produces: pagina `/settings` con tre blocchi: **Progetti** (tabella nome/path/team, aggiungi/modifica in `Dialog`, elimina con `confirm`; errori 400/409 mostrati nel dialog), **Default per stato** (una riga per `Backlog`, `Todo`, `In Progress`, `In Review` con `Select` modello ed effort), **Brainstorming di default** (`Switch`), **Tema** (scuro/chiaro, preferenza del browser in `localStorage` `mojito2-theme`, letta con try/catch; applica o toglie la classe `dark` su `html`). Salvataggio dei default con un unico `PUT`.

- [ ] **Step 1:** Test `safeArea.test.ts` (sul modello di `tests/client/safeArea.test.ts`): `index.html` contiene `viewport-fit=cover` e `black-translucent`; `index.css` definisce `--sat --sar --sab --sal` con `env(safe-area-inset-*, 0px)`; i sorgenti di `Toolbar.tsx`, `TerminalPage.tsx`, `AccessoryBar.tsx` contengono rispettivamente `var(--sat)`, `var(--sat)`, `var(--sab)`.
- [ ] **Step 2:** Run — Expected: FAIL se manca qualcosa; altrimenti PASS (i token sono stati posati nei Task 11–15).
- [ ] **Step 3:** Implementa `SettingsPage`.
- [ ] **Step 4:** Run test + typecheck — Expected: PASS.
- [ ] **Step 5:** Verifica: aggiungi un progetto con path relativo → errore nel dialog; modifica il default di `Todo` a `sonnet/medium` → il `TicketSheet` di un ticket Todo parte con quei valori.
- [ ] **Step 6:** Commit `feat(v2/web): settings page and safe-area guard`.

---

### Task 17: Build di produzione e servizio

**Files:**
- Create: `deploy/mojito2.service`, `apps/server/test/static.integration.test.ts`
- Modify: `Makefile` (target `v2-install-service`, `v2-deploy`), `README.md` (sezione "Mojito v2")

**Interfaces:**
- Consumes: `createApp({ staticDir })` (Task 9).
- Produces: `pnpm v2:build` produce `apps/web/dist` e `apps/server/dist/main.js`; `pnpm v2:start` serve entrambe da `:3100` con `staticDir = <repoRoot>/apps/web/dist`.
  `deploy/mojito2.service`: `Type=simple`, `WorkingDirectory=%h/code/mojito`, `ExecStart=/usr/bin/env pnpm v2:start`, `Restart=on-failure`, `Environment=MOJITO_PORT=3100`, `KillMode=control-group`. `make v2-install-service`: copia in `~/.config/systemd/user/`, `daemon-reload`, `enable --now`, controllando l'exit di ogni comando (`if ! …; then exit 1; fi`, Make 3.81 ignora `.SHELLFLAGS`). `make v2-deploy`: `git pull --ff-only && pnpm install && pnpm v2:build && systemctl --user restart mojito2`.

- [ ] **Step 1:** Test d'integrazione: avvia `createApp` su una porta libera con `staticDir` temporanea contenente `index.html`; `GET /` e `GET /session/x` → HTML; `GET /api/health` → JSON.
- [ ] **Step 2:** Run — Expected: PASS (la logica è del Task 9; questo test ne protegge il cablaggio con il build).
- [ ] **Step 3:** Scrivi unit file, target Make e README.
- [ ] **Step 4:** Verifica: `pnpm v2:build && make v2-install-service`; `systemctl --user status mojito2` attivo; lancia una sessione; `systemctl --user restart mojito2`; `cat /proc/$(pgrep -x tmux | head -1)/cgroup` mostra un `run-*.scope`; la sessione è ancora viva e riappare nella board.
- [ ] **Step 5:** Run `pnpm v2:test && pnpm v2:typecheck && pnpm test` — Expected: tutto PASS (anche la suite della vecchia app).
- [ ] **Step 6:** Commit `chore(v2): production build and systemd unit`.
