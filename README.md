# Mojito

Next.js + TypeScript app (GUI + local server) that launches and monitors Claude Code
ticket-lifecycle sessions, with Mojito-owned prompts and Linear writes. See
[`CLAUDE.md`](./CLAUDE.md) for architecture.

## Running

```bash
make start
```

Starts the dev server (Mac kept awake via `caffeinate`) and prints every reachable
URL: **Local**, **Wi-Fi/LAN**, and — when the tailnet is up — **Tailscale**.

```bash
make prod
```

Same conveniences — `caffeinate`, the URL banner, a health supervisor that restarts a
wedged server, and automatic pickup of source changes — but the app is served from an
optimized `next build`, so the GUI is noticeably faster. Use it when you're *running*
Mojito rather than working on it.

The trade-off is no HMR: a source change under `src/` (or in `server.ts` /
`next.config.mjs` / `tailwind.config.ts` / `postcss.config.mjs` / `package.json` /
`tsconfig.json`) triggers `tsc --noEmit` and then a full rebuild, and the app is **down
for the length of that build**. The typecheck runs first, while the old build is still
being served, so a typo costs no downtime — the rebuild only starts once the tree is
clean. `public/` is not watched: Next serves it from disk, no rebuild needed.

Config lives in `.env.local`:

- `MOJITO_PORT` — port to bind (default `4711`).
- `MOJITO_HOST` — address to bind (default `0.0.0.0`). Set `127.0.0.1` on a host reached
  only through `tailscale serve`, so the plain-http port is never exposed on a public interface.
- `MOJITO_TOKEN` — auth token; when set, the printed URLs include `?token=…`.

Tests: `npx tsc --noEmit && npx vitest run`.

## Install it as an app

Mojito is a PWA, so it can be installed to a home screen or a dock and run without
browser chrome. What you have to do first depends entirely on the browser, because
**Chromium only offers "Install" on a secure origin** and `server.ts` speaks plain
http:

| Browser | What to do |
| --- | --- |
| **Safari, iOS** | Open any of the URLs above → Share → *Add to Home Screen*. Works over http. |
| **Safari, macOS** | Open any of the URLs above → Share → *Add to Dock*. Works over http. |
| **Chrome/Edge, on this Mac** | Open the **Local** URL. `localhost` is the one http origin browsers trust, so the install button is already in the address bar. |
| **Chrome/Edge/Android, anywhere else** | Needs HTTPS — run `make https` once, then open the **Tailscale Serve** URL. |

```bash
make https      # tailscale serve --bg $PORT  →  https://<host>.<tailnet>.ts.net
make https-off  # tear it down again
```

`make https` is a one-time setup: Tailscale Serve runs in the background, survives
reboots, and terminates TLS with a real Let's Encrypt certificate, so there is no
certificate warning to click through — which matters, because a browser does *not*
treat an origin with a certificate error as secure and would refuse to install
anyway. It adds a front door without closing any: the http URLs keep working.

Two things worth knowing once installed:

- **The token is per-install.** `start_url` is `/` and carries no token, and an
  installed app does not necessarily share `localStorage` with the browser you
  installed it from (iOS gives home-screen apps their own container). Expect the
  token gate once on first launch; it is remembered from then on.
- **Serve is also a secure context**, which is the one thing that would let the
  phone use `navigator.clipboard`. Mojito does not currently take advantage of
  that — the terminal's copy path is still the accessory bar's text view.

The icons come from `public/icon.svg`; run `scripts/gen-icons.sh` after editing it to
re-cut the PNGs.

## Remote access over Tailscale

To open Mojito from your phone on any network, use the **Tailscale** URL printed by
`make start` (`http://<tailnet-ip>:<port>/?token=…`). The server binds `0.0.0.0`, so a
device on your tailnet reaches the Mac's tailnet IP directly over WireGuard — no public
exposure, no HTTPS or Tailscale Serve needed.

### Shields Up gotcha

Tailscale's **Shields Up** mode blocks *all* incoming connections to your Mac from the
tailnet. Crucially, `tailscale ping` / disco still succeed, so the tunnel *looks* healthy.

**Symptom:** the phone browser shows `ERR_CONNECTION_TIMED_OUT` on the Tailscale URL,
while `tailscale ping <mac>` returns a pong.

```bash
# Allow inbound — required for the phone to reach Mojito:
tailscale set --shields-up=false

# Re-block all inbound connections from the tailnet:
tailscale set --shields-up=true

# Check the current state:
tailscale debug prefs | grep -i shields
```

`--shields-up` is a persistent Tailscale preference (survives reboots), so if remote
access silently stops working, check this first.

## Mojito v2

Riscrittura del nucleo di Mojito come workspace pnpm, accanto all'app Next.js attuale
(che non viene toccata): `apps/server` (Hono + SQLite + tmux), `apps/web` (Vite + React,
Tailwind e shadcn) e `packages/shared` (tipi e schemi condivisi). Convive con la vecchia
app: porta `3100` invece di `4711`, servizio `mojito2` invece di `mojito`, stato in
`~/.local/state/mojito2` (`MOJITO_STATE_DIR` lo sovrascrive; il database è
`mojito.db`), prefisso tmux `mj-`. `LINEAR_API_KEY` e `MOJITO_TOKEN` si leggono da
variabili d'ambiente o da `.env.local` nella radice del repo, condivisi con la vecchia app,
e non arrivano mai nell'ambiente delle sessioni.

Porta e indirizzo sono invece solo di v2:

- `MOJITO2_PORT` — porta (default `3100`).
- `MOJITO2_HOST` — indirizzo (default `127.0.0.1`).

`MOJITO_PORT` e `MOJITO_HOST` vengono ignorati di proposito: stanno nello stesso
`.env.local` e appartengono alla vecchia app. Una porta già occupata fa uscire il server
con errore invece di lasciarlo vivo senza ascoltare.

v2 ascolta solo su `127.0.0.1`, come la vecchia app: la macchina ha un indirizzo pubblico
e non va esposta. Dal Mac e dal telefono si passa da Tailscale Serve su una porta a parte,
senza toccare la configurazione della vecchia app (serve root, oppure una volta
`sudo tailscale set --operator=$USER`):

```bash
tailscale serve --bg --https=8443 3100   # poi https://<host>.<tailnet>.ts.net:8443
```

Sviluppo, con server (`tsx watch`, porta 3100) e Vite (porta 5173) in parallelo:

```bash
pnpm v2:dev
```

Build di produzione e avvio da un solo processo, che serve API, websocket e client da
`:3100`:

```bash
pnpm v2:build   # apps/web/dist e apps/server/dist/main.js
pnpm v2:start
```

Come servizio systemd utente (Linux), accanto a `mojito.service`. Tutti e due i comandi
vanno lanciati dal checkout principale (`~/code/mojito`), quello che l'unità serve — mai da
un worktree:

```bash
pnpm v2:build
make v2-install-service   # rifiuta se manca apps/server/dist/main.js; copia l'unità, enable --now
make v2-deploy            # pull --ff-only, pnpm install --frozen-lockfile, build, restart,
                          # poi attende /api/health fino a 30s e fallisce se non risponde
```

L'unità parte da `~/code/mojito` e non ha un `EnvironmentFile`: il server legge da solo
`.env.local`. Le sessioni tmux nascono in uno scope systemd a parte, quindi sopravvivono
al riavvio del servizio. Log: `journalctl --user -u mojito2`.

Test: `pnpm v2:test && pnpm v2:typecheck`.
