SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

# NOTE: macOS ships GNU Make 3.81, which ignores `.ONESHELL:` (added in 3.82).
# So each recipe must run as a SINGLE logical shell line (backslash-continued),
# otherwise every physical line runs in its own shell and variables set on one
# line are gone on the next. The `=` (recursive) snippet vars below keep their
# `$$` until they are expanded into a recipe, so they compose correctly.
#
# `.SHELLFLAGS` landed in 3.82 as well, so it is likewise ignored there: on macOS
# these recipes run under a plain `/bin/bash -c` with NO `-e`, and a command that
# fails mid-recipe is walked straight past with the target still reporting success.
# Do not trust `-e` in a recipe that has to run on the Mac — check the exit status
# yourself, as `https` does. (It does apply on the Linux box, whose make is newer,
# which is why `restart` can lean on it.)

# Load .env.local, then resolve port (default 4711) and token.
LOAD_ENV = set -a; { [ -f .env.local ] && . ./.env.local; } || true; set +a; PORT="$${MOJITO_PORT:-4711}"; TOKEN="$${MOJITO_TOKEN:-}"

# systemd user unit for the production deploy (Linux box). Overridable.
SERVICE ?= mojito.service

# Print every reachable URL (local, Wi-Fi/LAN, Tailscale direct IP, and Tailscale
# Serve if enabled). Expects PORT and TOKEN to be set (run $(LOAD_ENV) first).
# Appends the token query so the URL is usable as-is (auth). LAN IP is taken from
# the default-route interface (the one that actually reaches the network), falling
# back to en0. The Tailscale lines are best-effort: absent (not an error) when the
# tailnet is down, so a single `make start` works with or without Tailscale.
SHOW_URLS = Q=""; if [ -n "$$TOKEN" ]; then Q="/?token=$$TOKEN"; fi; \
	IFACE=$$(route -n get default 2>/dev/null | awk '/interface:/{print $$2}'); \
	LAN=$$(ipconfig getifaddr "$$IFACE" 2>/dev/null || ipconfig getifaddr en0 2>/dev/null || true); \
	TSIP=$$(tailscale ip -4 2>/dev/null | head -1 || true); \
	TS=$$(tailscale serve status 2>/dev/null | grep -oE 'https://[^ ]+' | head -1 || true); \
	echo ""; \
	echo "  Local:  http://localhost:$$PORT$$Q"; \
	if [ -n "$$LAN" ]; then echo "  Wi-Fi:  http://$$LAN:$$PORT$$Q   (open on your phone, same Wi-Fi)"; fi; \
	if [ -n "$$TSIP" ]; then echo "  Tailscale: http://$$TSIP:$$PORT$$Q   (any network, via VPN)"; fi; \
	if [ -n "$$TS" ]; then echo "  Tailscale Serve: $$TS$$Q   (HTTPS hostname)"; fi; \
	echo ""

## help: list targets
help:
	@echo "Targets:"
	@echo "  make start    dev server (Mac kept awake), prints every URL: local, Wi-Fi, Tailscale"
	@echo "  make prod     next build, then serve it under a health supervisor (no rebuild on change)"
	@echo "  make restart  prod deploy: next build, then restart $(SERVICE) (systemd --user) + health check"
	@echo "  make https    put Mojito behind the Tailscale HTTPS hostname (needed to install it in Chrome)"
	@echo "  make https-off  tear that down again"

## start: dev server, Mac kept awake via caffeinate; prints every reachable URL
## (local, Wi-Fi/LAN, and — when the tailnet is up — the Tailscale direct IP, which
## the phone hits over WireGuard from any network, no public exposure / HTTPS needed).
start:
	@$(LOAD_ENV); \
	$(SHOW_URLS); \
	echo "  (Mac kept awake — Ctrl-C to stop)"; \
	echo ""; \
	export MOJITO_PORT="$$PORT"; \
	exec caffeinate -is ./scripts/dev-supervisor.sh

## prod: one `next build`, then that build is served under the health supervisor —
## caffeinate and the URL banner as in `start`, but never Next's dev server, so the
## GUI is fast. Editing a file rebuilds nothing: the supervisor restarts the server
## only when /api/health stops answering. A source change goes live when you ask for
## it — Mojito's "Pull & deploy" button, or SIGUSR2 to the pid in
## .prod-supervisor.pid (see scripts/prod-supervisor.mjs).
prod:
	@$(LOAD_ENV); \
	$(SHOW_URLS); \
	echo "  (production build — Mac kept awake, no rebuild on change, Ctrl-C to stop)"; \
	echo ""; \
	export MOJITO_PORT="$$PORT"; \
	exec caffeinate -is node ./scripts/prod-supervisor.mjs

## restart: rebuild the Next app (next build) then restart the systemd user service
## and wait for /api/health. Production deploy path on the Linux box (NOT `make start`,
## which is the macOS dev supervisor). A failed build aborts before the restart
## (SHELLFLAGS -e), so the running server is never replaced by a broken build.
restart:
	@echo "==> Building (next build)…"; \
	pnpm build; \
	echo "==> Restarting $(SERVICE)…"; \
	systemctl --user restart "$(SERVICE)"; \
	$(LOAD_ENV); \
	echo "==> Waiting for health on http://localhost:$$PORT/api/health …"; \
	for i in $$(seq 1 30); do \
		code=$$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://localhost:$$PORT/api/health" || true); \
		if [ "$$code" = "200" ]; then echo "OK — mojito healthy on http://localhost:$$PORT"; exit 0; fi; \
		sleep 1; \
	done; \
	echo "WARN: no HTTP 200 after 30s — check: journalctl --user -u $(SERVICE) -e" >&2; \
	exit 1

## https: front Mojito with Tailscale Serve, i.e. an https://<host>.<tailnet>.ts.net
## URL with a real Let's Encrypt certificate. Needed to *install* Mojito as an app in
## Chrome or on Android: Chromium only offers "Install" on a secure origin, and
## server.ts speaks plain http (localhost is the one http origin browsers trust, which
## is why installing works on the Mac already and nowhere else). Safari needs none of
## this — iOS "Add to Home Screen" and macOS "Add to Dock" work off the http URL.
##
## Runs in the background (--bg) and persists across reboots, so this is a one-time
## setup rather than something to run beside `make start`. The plain http URLs keep
## working: Serve adds a front door, it does not close the others. SHOW_URLS already
## prints the resulting hostname, so this ends by re-printing the banner.
## The `if !` is not stylistic: `.SHELLFLAGS` is ignored by the make that ships with
## macOS (see the header note), so `-e` is not in effect here and a failing
## `tailscale serve` would otherwise be walked straight past — printing a banner with
## no Serve URL in it under a line telling you to go open the Serve URL. Which is
## exactly what it did before this check; a stopped tailnet is the common case.
https:
	@$(LOAD_ENV); \
	echo "==> tailscale serve --bg $$PORT"; \
	if ! tailscale serve --bg "$$PORT"; then \
		echo "" >&2; \
		echo "  Could not hand Mojito to Tailscale Serve. If the line above says the" >&2; \
		echo "  tailnet is stopped, run \`tailscale up\` and try again; if it asks for" >&2; \
		echo "  HTTPS certificates, enable them for the tailnet in the admin console." >&2; \
		echo "" >&2; \
		exit 1; \
	fi; \
	$(SHOW_URLS); \
	echo "  Open the Tailscale Serve URL to get Chrome's install prompt."; \
	echo ""

## https-off: drop the Serve front door (the http URLs are unaffected). Note this
## resets *all* serve config for this node, not only Mojito's — `tailscale serve
## reset` has no per-target form.
https-off:
	@echo "==> tailscale serve reset"; \
	tailscale serve reset; \
	echo "OK — Tailscale Serve is off; the http URLs still work."

.PHONY: help start prod restart https https-off
