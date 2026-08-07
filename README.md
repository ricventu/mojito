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

Config lives in `.env.local`:

- `MOJITO_PORT` — port to bind (default `4711`).
- `MOJITO_TOKEN` — auth token; when set, the printed URLs include `?token=…`.

Tests: `npx tsc --noEmit && npx vitest run`.

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
