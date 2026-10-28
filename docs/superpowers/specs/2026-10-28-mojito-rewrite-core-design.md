# Mojito rewrite — nucleo (sotto-progetto 1)

Data: 2026-10-28 · Branch: `rewrite-core`

## Obiettivo

Riscrivere Mojito da zero su uno stack nuovo, partendo dal nucleo: vedere i ticket Linear
per progetto, lanciarli in sessioni Claude Code interattive in tmux mostrate con xterm v6,
creare ticket tramite l'Agent SDK, aprire sessioni libere. Tutto usabile anche da telefono.
Le altre funzioni dell'app attuale arrivano dopo, una alla volta, ciascuna con spec e piano
propri (vedi **Roadmap**).

Successo = la nuova app, affiancata alla vecchia, basta per il lavoro quotidiano sui
ticket: board, lancio, terminale (anche da iPhone), creazione ticket, sessioni libere, e
le sessioni sopravvivono al riavvio del server.

### Fuori dal nucleo

Filtri e preferiti, sidebar delle sessioni, merge gate, toolbar di progetto, git graph,
docs viewer, CLI `mojito`, PWA, self-update, renderer WebGL, "migliora ticket", supporto
`qwen`. **Worktree al lancio non verrà portato**: il worktree, se serve, lo crea la
sessione stessa.

## Stack

- **Server**: Node + Hono (`@hono/node-server`), TypeScript, `better-sqlite3`,
  `node-pty`, `ws`, `@anthropic-ai/claude-agent-sdk`.
- **Web**: React 19 + Vite, Tailwind v4, shadcn/ui (Radix), `react-router`,
  TanStack Query, `lucide-react`, `@xterm/xterm` v6 + `@xterm/addon-fit`.
- **Shared**: tipi e schemi zod per API ed eventi WS.
- pnpm workspace, vitest ovunque.

## 1. Architettura e persistenza

### Layout del repo

```
apps/server/       Hono server
apps/web/          React + Vite
packages/shared/   tipi/schemi condivisi
```

Il codice attuale (`src/`, `server.ts`, config Next) resta intatto fino al cut-over.

### Processo server

Un solo processo:

- `/api/*` — REST, autenticato con token (`x-mojito-token`, oppure `?token=` al primo
  accesso, salvato dal client e rimosso dall'url). `/api/health` e `/api/hook` hanno
  regole proprie (health aperto; hook autenticato col token iniettato nei settings).
- `/ws/events` — unico canale eventi server→client: `session.*`, `task.*`,
  `tickets.changed`. Fire-and-forget: il client rifà il fetch completo a ogni
  connessione e a ogni `visibilitychange` verso visibile.
- `/ws/pty/:sessionId` — un `tmux attach` dentro `node-pty` per socket; frame di resize
  dal client.
- In produzione serve la build statica di `apps/web`; in dev Vite fa da proxy verso il
  server.

### Coesistenza con la vecchia app

- Porta `MOJITO2_PORT` (default `3100`) e indirizzo `MOJITO2_HOST` (default `0.0.0.0`);
  `MOJITO_PORT`/`MOJITO_HOST` sono della vecchia app, nello stesso `.env.local`, e v2 li
  ignora (R29).
- Prefisso tmux `mj-` (la vecchia app usa `mojito-`): nessuna delle due adotta le
  sessioni dell'altra.
- State dir `~/.local/state/mojito2/` (DB, settings degli hook, upload temporanei).
- Unit systemd utente `mojito2.service`.

### SQLite

`better-sqlite3`, file `<stateDir>/mojito.db`, migrazioni SQL numerate applicate
all'avvio.

| Tabella     | Contenuto |
|-------------|-----------|
| `projects`  | `name` (PK), `path`, `team_key` |
| `settings`  | `key` (PK), `value` JSON — default modello/effort per stato, brainstorming di default |
| `sessions`  | `id` (= nome tmux), `kind` (`ticket`/`claude`/`shell`), `project`, `ticket`, `cwd`, `model`, `effort`, `brainstorming`, `state`, `created_at`, `last_event_at` |
| `sdk_tasks` | `id`, `type` (`create-ticket`), `input` JSON, `status` (`queued`/`running`/`done`/`failed`), `log` JSON, `error`, `result` JSON (identifier, url), `created_at`, `updated_at` |

Import iniziale: se `projects` è vuota all'avvio, si importa una volta
`~/.config/mojito/projects.json` (`MOJITO_PROJECTS` lo sovrascrive). Da lì in poi la
fonte è il DB, modificato dalla pagina Settings.

`LINEAR_API_KEY` e `MOJITO_TOKEN` restano in `.env.local` e non vanno mai nel DB.

I ticket **non** sono nel DB: il server li legge da Linear (polling ~45s, più refresh
mirato dopo ogni azione e su ogni hook `Stop`), li tiene in cache in memoria ed emette
`tickets.changed`. Linear è l'unica fonte di verità sugli stati, che ora vengono scritti
anche dalle sessioni.

### Riavvio e riconciliazione

All'avvio il server confronta `sessions` con `tmux ls`:

- riga con tmux vivo → si mantiene;
- riga senza tmux → `state = ended`;
- tmux `mj-*` senza riga → adottata; il `kind` si ricava dal prefisso dell'id.

I `sdk_tasks` in `running` o `queued` passano a `failed` con errore
"interrotto dal riavvio".

### Ambiente dei processi figli

Si porta la sanificazione attuale (`childEnv.ts`): nessun processo figlio eredita
`process.env` così com'è; vengono rimossi `NODE_ENV`, i `npm_*`, le chiavi lette da
`.env*` (calcolate per differenza, non con un elenco fisso), le variabili del bundler
(`TURBOPACK` e simili, in `DROP_EXACT` incondizionatamente), e si emettono override `-e`
di tmux per ciò che un server tmux preesistente ancora fa trapelare. Sotto systemd ogni
`new-session` parte in uno scope proprio (`systemd-run --user --scope`) così un restart
del servizio non uccide le sessioni (vedi fb74a37).

## 2. Sessioni ticket

### Lancio

Il sheet del ticket offre:

- **Modello**: `opus` / `sonnet` / `haiku`; default per stato da `settings`.
- **Effort**: `low` / `medium` / `high` / `xhigh` / `max`; default per stato.
- **Brainstorming**: toggle; default da `settings`.
- **Avvia**, oppure **Apri terminale** se il ticket ha già una sessione viva.

Una sola sessione per ticket: id tmux `mj-<TICKET>` (es. `mj-RIC-123`). Un lancio che
trova il nome già occupato risponde 409 e il client apre il terminale esistente.

Comando, eseguito in tmux con cwd = `projects.path` e ambiente sanificato:

```
claude --model <m> --effort <e> --settings <stateDir>/hooks/<id>.json '<prompt>'
```

### Prompt

Unico template in `apps/server/src/prompts/ticket.ts`. Nessun testo del ticket, nessun
file di contesto, nessun file di risultato.

Senza brainstorming:

```
Leggi il ticket RIC-123 da Linear ed eseguilo.
Quando il lavoro è pronto per la revisione, sposta il ticket in "In Review" su Linear.
```

Con brainstorming:

```
Leggi il ticket RIC-123 da Linear ed eseguilo.
Prima di implementare, usa la skill superpowers:brainstorming.
Quando il lavoro è pronto per la revisione, sposta il ticket in "In Review" su Linear.
```

Un test fissa il testo esatto di entrambe le varianti.

La sessione legge e scrive Linear con **il MCP Linear configurato nel Claude Code
dell'utente**, non con le credenziali di Mojito. Mojito non lo verifica: se manca,
l'errore è visibile nel terminale.

### Stati Linear

- Al lancio Mojito scrive **In Progress** e assegna il ticket all'utente della API key.
  Se la scrittura fallisce la sessione parte comunque e il client mostra un toast.
- **In Review** lo scrive la sessione via MCP.
- Ogni altro spostamento (incluso Done) si fa a mano dal selettore di stato nel sheet,
  che nel nucleo offre tutti gli stati del team.

### Stato live

Gli hook di Claude Code (scritti in `<stateDir>/hooks/<id>.json` e passati con
`--settings`) fanno `curl` verso `/api/hook?session=<id>&event=<E>`. Mappatura:

| Evento | Stato |
|--------|-------|
| `SessionStart`, `UserPromptSubmit`, `PostToolUse` | `running` |
| `PermissionRequest`, `Notification`, `PreToolUse[AskUserQuestion]` | `needs-input` |
| `Stop` | `idle` (+ refresh del ticket) |
| `SessionEnd` | `ended` |

Al lancio lo stato è `starting`. Il watchdog di startup resta: una sessione ancora in
`starting` dopo `STALL_GRACE_MS` passa a `needs-input` (prompt di trust di Claude Code,
RIC-222); un `SessionStart` tardivo la riporta a `running`.

Un hook con id sconosciuto risponde 200 e viene ignorato; il comando hook finisce sempre
con `|| true` e non può far fallire claude.

### Chiusura

Solo su azione esplicita (Kill → `DELETE /api/sessions/:id`): Ctrl-C, poi Ctrl-D
ripetuto a ogni poll, mai `kill-session`. Una sessione che claude non lascia chiudere
risponde 409 e resta com'è. Mojito non chiude mai una sessione da solo. Una sessione
`ended` (tmux sparito) si rimuove dalla board con **Rimuovi**, che cancella solo la riga.

## 3. Task SDK e sessioni libere

### Crea ticket (task SDK)

Sheet "+ Ticket": progetto, nota libera, immagini (selezione, incolla, drag & drop).

1. `POST /api/tasks` (multipart). Il server carica le immagini su Linear con la propria
   API key (`fileUpload`), salva la riga `sdk_tasks` con nota, progetto e URL, risponde
   201 e il sheet si chiude.
2. La coda (massimo 2 task contemporanei) esegue `query()`:
   - `model: "sonnet"`;
   - nessun tool built-in (`tools: []`), nessun `settingSources`;
   - un server MCP in-process `mojito-linear` (`createSdkMcpServer`) con due tool,
     pre-approvati in `allowedTools`:
     - `list_labels(team)`;
     - `create_issue(team, project, title, description, labelId?)`;
   - messaggio utente con la nota, le immagini come blocchi immagine (base64, così il
     modello le vede) e gli URL Linear da incorporare come `![](url)` in fondo alla
     descrizione (paragrafo presente solo se ci sono immagini).
3. Istruzioni, dall'attuale `intake.ts`: riscrivere in italiano, dare un titolo di una
   riga senza id, conservare ogni dettaglio concreto, nessun requisito inventato, al
   massimo una label tra `Bug`/`Improvement`/`Feature` (nessuna se non calza), nessuna
   priorità. **Non fa domande**: una nota vaga diventa un ticket fedele alla nota.
4. Ogni messaggio dell'agente viene aggiunto a `log` ed emesso come `task.updated`; a
   fine lavoro `result` contiene identifier e url del ticket creato, e parte un refresh
   della board.
5. Errore (login scaduto, rate limit, tool fallito) → `failed` con il messaggio. **Riprova**
   rilancia con lo stesso input, senza ricaricare le immagini.

Autenticazione: l'SDK usa le credenziali del `claude` loggato sulla macchina, cioè la
subscription dell'utente; il server non gestisce API key Anthropic.

### Sessioni libere

Sheet "+ Sessione":

- **Progetto**: uno dei progetti, oppure **General** (cwd = home).
- **Tipo**: `claude` (modello ed effort selezionabili, nessun prompt) oppure `shell`
  (`$SHELL -l`).

Id tmux `mj-<slug-progetto|general>-<hex>`. Le sessioni `claude` hanno hook e stato live
come le sessioni ticket; le `shell` non emettono hook, partono e restano in `running`.

## 4. Interfaccia

### Principi

- Solo Tailwind e componenti shadcn/ui; nessun foglio CSS scritto a mano oltre ai token
  del tema e a ciò che xterm richiede.
- Dati con TanStack Query; gli eventi di `/ws/events` invalidano le query
  corrispondenti; nessun polling lato client.
- Tema scuro di default, chiaro opzionale.
- Logica in moduli puri testabili, glue negli hook React (la stessa divisione
  dell'app attuale).

### Rotte

- `/` — board
- `/session/:id` — terminale
- `/settings` — impostazioni

### Board

- Toolbar sticky: **+ Ticket**, **+ Sessione**, indicatore needs-input (conteggio su
  tutte le sessioni; tocco = apre la prima), Settings.
- Striscia dei task SDK sotto la toolbar, presente solo se ci sono task non archiviati:
  stato, log espandibile, link al ticket creato, Riprova sui falliti, ✕ per archiviare.
- Una sezione per progetto (più **General** se ci sono sessioni libere senza progetto):
  ticket ordinati In Review → In Progress → Todo, poi un gruppo **Backlog** chiuso di
  default; sotto, le sessioni libere del progetto.
- Card ticket: id come link a `issue.url`, stato, titolo, label, badge dello stato
  della sessione se presente.
- Tocco su card → sheet del ticket (lancio o Apri terminale, selettore di stato, Kill).
- Banner "Linear non raggiungibile — dati delle HH:MM" quando l'ultimo polling è fallito.

### Terminale

- Header: ← Board, id + titolo + stato del ticket (o nome della sessione libera), badge
  dello stato live, Kill.
- xterm v6 con renderer DOM, `addon-fit`.
- Accessory bar sui dispositivi touch: composer, `↑ ↓ ← → ⏎ ⇧⏎ Esc Tab ⇧Tab ^C`,
  copia del buffer.

### Telefono

Moduli da riscrivere con i loro test, portando i comportamenti attuali:

- **Safe area**: `viewport-fit=cover` + status bar `black-translucent`, token
  `--sat/--sar/--sab/--sal`; ogni superficie che tocca un bordo li paga.
- **Tastiera**: `keyboardInset`; con la tastiera su, il terminale non si ri-adatta ma
  resta ancorato in basso; l'header si nasconde.
- **Geometria**: `syncGeometry` — il re-fit si rifiuta con tastiera su o geometria
  inutilizzabile, l'invio della dimensione al pty **mai** (RIC-258).
- **Composer**: `<textarea>` vero, iniettato con `term.paste`, senza CR.
- **Copia**: `<pre>` con `bufferText` (righe a capo ricongiunte, trim a destra fatto da
  noi, righe vuote solo ai bordi).
- **Touch scroll** del terminale.

`restoreTerminalPlatform` non viene portato alla cieca: un test verifica che sotto Vite
xterm rilevi `isMac` correttamente; il fix si porta solo se il test fallisce.

### Settings

- Progetti: aggiungi / modifica / elimina (nome, path assoluto, team key).
- Default di modello ed effort per stato del ticket.
- Brainstorming di default.

## 5. Errori, test, deploy

### Errori

- **Linear** non raggiungibile: cache + banner; le scritture rispondono con errore e
  toast, senza effetti parziali; il lancio di una sessione non è bloccato.
- **tmux**: nome occupato → 409; Kill rifiutato → 409, la sessione resta visibile.
- **WebSocket**: reconnect con backoff, refetch completo a ogni connessione.
- **SDK**: `failed` + messaggio + Riprova.
- **Hook** sconosciuto: 200, ignorato.

### Test

- `apps/server`: unit sui moduli puri (mappatura hook→stato, prompt builder,
  riconciliazione tmux↔DB, sanificazione env, tool MCP con client Linear finto, coda
  dei task); route Hono via `app.request()` con SQLite in memoria; un test d'integrazione
  con tmux reale (lancio, attach, kill gentile, sessione che rifiuta), saltato se tmux
  manca.
- `apps/web`: unit sui moduli puri del terminale (`syncGeometry`, `keyboardInset`,
  `bufferText`, `composerHeight`), test su safe area, rilevamento piattaforma di xterm.
- Un test di packaging sul workspace (un solo lockfile, `allowBuilds` per `node-pty`,
  `better-sqlite3` e `esbuild`, permessi di `spawn-helper`).

### Avvio e deploy

- `pnpm dev`: server (tsx watch) + Vite, in parallelo.
- `pnpm build`: build di web (Vite) e server (tsup); `pnpm start` serve tutto da un
  processo.
- `mojito2.service` (systemd utente) sulla porta 3100, accanto a `mojito.service`.
- Aggiornamento manuale nel nucleo: `git pull && pnpm install && pnpm build &&
  systemctl --user restart mojito2`.

### Cut-over

Quando i sotto-progetti necessari sono portati, `mojito2` prende porta e nome del
servizio attuale e il vecchio codice (`src/`, `server.ts`, Next, relativi test) viene
rimosso in un commit dedicato. Il prefisso tmux `mj-` resta.

## Roadmap dei sotto-progetti successivi

Ordine da decidere di volta in volta; ognuno con spec e piano propri.

1. Filtri, preferiti e sidebar delle sessioni
2. Merge gate (review → merge → Done); il branch del ticket si trova con la ricerca per
   id nel nome del branch, ovunque la sessione abbia creato il worktree
3. Toolbar di progetto (start/stop/logs/pull/push/deploy)
4. Git graph
5. Docs viewer
6. CLI `mojito`
7. PWA e self-update
8. Renderer WebGL, se il DOM renderer risulta lento sul telefono
