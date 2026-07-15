# Dev Server Watchdog — Design

**Date:** 2026-07-15
**Status:** Approved

## Problem

When a lime session merges a Mojito ticket in `local` mode, it checks out `main` and
merges **in the main checkout** — while the dev server is running there. `tsx watch
server.ts` only watches the `server.ts` import graph (`src/server/**`), so a merge that
touches other files (app UI, `next.config.mjs`, large churn) never restarts the process.
The running Next dev instance gets wedged with its `.next` state invalidated and every
request fails with:

```
[Error: ENOENT: no such file or directory, open '.../.next/required-server-files.json']
GET / 500
```

It stays broken until someone manually restarts the server.

## Solution

A health-check supervisor wraps the dev server: it polls a health endpoint and restarts
the process when it becomes persistently unhealthy. Self-contained in Mojito — no changes
to lime, and it also recovers from any future wedge (crash, OOM, other Next breakage).

## Components

### 1. Health endpoint — `src/app/api/health/route.ts` (new)

A GET route that returns `200 "ok"`. No auth: it leaks nothing, and the poller should not
need the token. When Next is wedged, every request through the handler 500s — including
this one. That asymmetry (200 when fine, 5xx when wedged) is the whole signal.

### 2. Supervisor — `scripts/dev-supervisor.sh` (new)

Bash script owning the restart loop:

- Enables job control (`set -m`) and starts `pnpm dev` in the background so it gets its
  own process group; remembers the PID.
- Every **5s**, curls `http://localhost:$PORT/api/health` with `--max-time 5`, reading
  only the HTTP status code.
- State machine per child lifetime:
  - Any HTTP response (including 4xx) → mark healthy, reset the failure counter.
  - `000` (no response) **before** the first response → still compiling; don't count.
  - 5xx, or `000` **after** having been healthy → increment the failure counter.
  - **3 consecutive failures** → log the reason and kill the child's process group
    (`kill -- -$PID`, SIGTERM; SIGKILL after 5s if still alive).
- When the child exits (killed or crashed on its own), log it, sleep 2s, respawn.
- Shutdown: a TERM trap, plus interrupt detection on the poll sleep — under `set -m`
  Ctrl-C's SIGINT hits the foreground sleep rather than the script, so a sleep killed by
  a signal triggers the same clean kill-group-and-exit. Ctrl-C behaves as today.
- Port comes from `MOJITO_PORT` env (default `4711`), exported by the Makefile, which
  already loads `.env.local`.

Worst-case time to kill: ~20s after the wedge (3 × 5s poll + TERM→KILL grace); full
recovery adds Next's recompile on respawn (~40s observed end-to-end).

### 3. Log noise suppression — `next.config.mjs` (edit)

Add:

```js
logging: { incomingRequests: { ignore: [/\/api\/health/] } },
```

so the 5s poll doesn't spam the dev console with `GET /api/health 200` lines.

### 4. Makefile (edit)

`start`, `start-ngrok`, and `start-tailscale` swap `pnpm dev` for
`scripts/dev-supervisor.sh`, still under `caffeinate -is`. The Makefile exports
`MOJITO_PORT` to the supervisor. Behavior otherwise unchanged (URL printing, ngrok
bring-up, traps).

## What restarts and what doesn't

Restarting kills only the tsx/Next process:

- Lime sessions live in detached tmux and survive.
- The registry re-syncs on boot via the existing `recover()` call in `server.ts`.
- Browser tabs reconnect their websockets as they already do today.

## Error handling

- **Process-group kill** prevents orphaned `node` children holding the port, which would
  otherwise cause an EADDRINUSE respawn-churn loop.
- **Fixed 2s backoff** between respawns bounds churn if the server crashes at boot.
- The supervisor never exits on its own — only on INT/TERM (Ctrl-C).

## Testing

The failure-counter logic is trivial, so no unit tests. Manual verification:

1. `make start` — server comes up, console shows no health-poll log lines.
2. Wedge the server deliberately (delete `.next/routes-manifest.json`, or `kill -STOP`
   the node process) — supervisor logs the unhealthy detection and restarts within ~20s;
   the UI recovers without manual intervention.
3. Ctrl-C — supervisor, dev server, and children all exit; port is free.

## Out of scope

- Production mode (`npm start`) — the user runs `make start` (dev) day-to-day.
- Changing lime's merge flow (approach C from brainstorming) — rejected: cross-repo
  coupling, and it wouldn't cover manual git operations in the main checkout.
- In-process self-heal in `server.ts` (approach B) — rejected: `tsx watch` doesn't
  respawn on exit, so it needs the same outer loop anyway, with more moving parts.
