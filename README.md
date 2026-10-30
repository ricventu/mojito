# Mojito

Mojito manages Linear tickets per project and runs them as Claude Code sessions in tmux,
shown in the browser (phone first) through xterm. A pnpm workspace:

- `apps/server` — Node 22, Hono, SQLite (`better-sqlite3`), tmux, `node-pty`; serves the API,
  the websockets and the built client from one process.
- `apps/web` — React 19, Vite, Tailwind 4, shadcn/ui, xterm.
- `packages/shared` — types and zod schemas both sides use.

See [`CLAUDE.md`](./CLAUDE.md) for the architecture.

## Configuration

The server reads `.env.local` at the repo root (variables already set in the environment
win). Nothing it reads there reaches the sessions' environment.

- `MOJITO_TOKEN` — required; every `/api` call and websocket carries it.
- `LINEAR_API_KEY` — required.
- `MOJITO_PORT` — port (default `8700`).
- `MOJITO_HOST` — bind address (default `127.0.0.1`). The box has a public address: keep it
  on loopback and reach it through Tailscale Serve.
- `MOJITO_STATE_DIR` — state (default `~/.local/state/mojito`: the SQLite `mojito.db`, hook
  settings, uploaded images).
- `MOJITO_PROJECTS` — a `projects.json` imported once into a new database (default
  `~/.config/mojito/projects.json`); after that, projects are edited in Settings.

A port already in use makes the server exit with an error rather than stay up without
listening.

## Development

```bash
pnpm install
pnpm dev                       # server (tsx watch, :3100) + Vite (:5173, proxies /api and /ws)
pnpm test && pnpm typecheck
```

`pnpm dev` pins the server to 3100 and `~/.local/state/mojito-dev`, so it never collides
with the service on 8700 nor opens its database (live `mj-*` sessions are adopted into the dev
database, which is harmless).

## Deploy (Linux box)

Mojito runs as a systemd user unit from the `main` checkout in `~/code/mojito`:

```bash
pnpm build                     # apps/web/dist + apps/server/dist/main.js
make install-service           # copies deploy/mojito.service, enables and (re)starts it
make deploy                    # pull --ff-only (if tracked), frozen install, build, restart,
                               # then waits up to 30 s for /api/health
journalctl --user -u mojito    # logs
```

tmux sessions start in a systemd scope of their own, so they survive a restart of the
service.

## Deploy (macOS)

The same two targets run Mojito as the `com.mojito.server` LaunchAgent (`deploy/launchd.sh`):

```bash
pnpm build
make install-service           # writes ~/Library/LaunchAgents/com.mojito.server.plist and loads it
make deploy                    # pull, frozen install, build, rewrite the plist, reload, health
tail -F ~/Library/Logs/Mojito/mojito.log
```

Run both from the shell you use Mojito from: its PATH (node, tmux, claude) and locale are
baked into the plist, which every deploy rewrites, so a node switched under nvm is picked up
by the next deploy. `caffeinate` keeps the Mac awake while the server runs. Stopping the job
leaves the tmux sessions running.

The phone reaches it through Tailscale Serve (needs root once, or
`sudo tailscale set --operator=$USER`):

```bash
tailscale serve --bg 8700      # https://<host>.<tailnet>.ts.net/
```

If the phone times out while `tailscale ping` still answers, check Tailscale's Shields Up
(`tailscale debug prefs | grep -i shields`): it blocks every inbound connection from the
tailnet.

The previous app (Next.js) is kept at the `v1` tag.
