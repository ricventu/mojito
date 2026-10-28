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
	@echo "  make install-cli  install the \`mojito\` command (open a session in the current folder)"
	@echo "  make service-install  run \`make prod\` as a macOS LaunchAgent: starts at login, no terminal"
	@echo "  make service-uninstall | service-restart | service-status | service-logs"
	@echo "  make v2-install-service  install and start $(V2_SERVICE) (Mojito v2, port 3100, systemd --user)"
	@echo "  make v2-deploy  v2: git pull --ff-only (if tracked), pnpm install, pnpm v2:build, restart $(V2_SERVICE)"

## install-cli: write ~/.local/bin/mojito (override with BINDIR), a launcher for
## `bin/mojito` that opens a Mojito session in whatever directory you run it from.
## The launcher bakes the MAIN checkout's path, never $(PWD): a worktree deliberately
## has no .env.local (RIC-207) and can be removed at any time, so a launcher pointing
## at one would lose both the token and the file. Re-run it if the checkout moves.
BINDIR ?= $(HOME)/.local/bin
install-cli:
	@ROOT=$$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || { echo "not a git checkout"; exit 1; }; \
	ROOT=$${ROOT%/.git}; \
	if [ ! -x "$$ROOT/bin/mojito" ]; then echo "missing $$ROOT/bin/mojito"; exit 1; fi; \
	mkdir -p "$(BINDIR)" || exit 1; \
	printf '#!/bin/sh\nexec "%s/bin/mojito" "$$@"\n' "$$ROOT" > "$(BINDIR)/mojito" || exit 1; \
	chmod +x "$(BINDIR)/mojito" || exit 1; \
	echo "installed $(BINDIR)/mojito -> $$ROOT/bin/mojito"; \
	case ":$$PATH:" in *":$(BINDIR):"*) ;; *) echo "note: $(BINDIR) is not on your PATH";; esac

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

## service-*: `make prod` as a macOS LaunchAgent (com.mojito.server), so no terminal has
## to stay open: it starts at login and launchd restarts it if the supervisor dies.
## Everything lives in scripts/launchd-service.sh — a script rather than recipes, since
## make 3.81 gives these no `-e` (see the header note) and install has steps that must
## not be walked past. "Pull & deploy" works unchanged: it signals the supervisor through
## .prod-supervisor.pid either way. Re-run service-install after an nvm upgrade: the
## plist bakes the PATH it was installed from.
service-install:
	@./scripts/launchd-service.sh install && { $(LOAD_ENV); $(SHOW_URLS); }

service-uninstall:
	@./scripts/launchd-service.sh uninstall

service-restart:
	@./scripts/launchd-service.sh restart

service-status:
	@./scripts/launchd-service.sh status

service-logs:
	@./scripts/launchd-service.sh logs

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

## deploy: what "Pull & deploy" runs on the Linux box, in the transient systemd unit
## mojito-deploy (src/server/selfUpdate.ts#startDeployUnit): pnpm install, then restart.
## The install is unconditional, as in the Mac supervisor's cycle: a pull can bring a
## lockfile change. NODE_ENV is dropped for it, since an install under production can
## strip the devDependencies the build needs (RIC-207). Logs: journalctl --user -u mojito-deploy
deploy:
	@echo "==> Installing dependencies (pnpm install)…"; \
	env -u NODE_ENV pnpm install --frozen-lockfile; \
	$(MAKE) --no-print-directory restart

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

## v2-install-service: Mojito v2 (apps/server + apps/web) as a systemd user unit beside
## mojito.service, on port 3100. The unit's WorkingDirectory is ~/code/mojito-v2 (the
## checkout of branch v2, beside the v1 one on main), so run this from there, after
## `pnpm v2:build`: an unbuilt checkout is refused rather than installed
## as a unit that crash-loops on a missing dist/main.js. Every command's exit status is
## checked by hand: make 3.81 ignores .SHELLFLAGS, so there is no `-e` to lean on (see the
## header note).
V2_SERVICE ?= mojito2.service
V2_UNIT_DIR ?= $(HOME)/.config/systemd/user
v2-install-service:
	@if [ ! -f apps/server/dist/main.js ]; then \
		echo "apps/server/dist/main.js is missing: run 'pnpm v2:build' first (in ~/code/mojito-v2)" >&2; \
		exit 1; \
	fi; \
	if ! mkdir -p "$(V2_UNIT_DIR)"; then exit 1; fi; \
	if ! cp deploy/mojito2.service "$(V2_UNIT_DIR)/$(V2_SERVICE)"; then exit 1; fi; \
	if ! systemctl --user daemon-reload; then exit 1; fi; \
	if ! systemctl --user enable --now "$(V2_SERVICE)"; then exit 1; fi; \
	echo "OK — $(V2_SERVICE) installed and started (status: systemctl --user status $(V2_SERVICE))"

## v2-deploy: update Mojito v2 in place and restart it. Run it from ~/code/mojito-v2, the
## checkout the unit serves. The pull runs only when the branch tracks a remote: v2 may live
## as a local branch, worked on in that checkout directly. Each step aborts the deploy, so a failed pull,
## install or build never replaces the running server. The install is --frozen-lockfile: a
## lockfile out of step with the manifests is a broken commit, not something to re-resolve on
## the server. A restart is not a success until /api/health answers, which it must within
## 30s (the unit's own MOJITO2_PORT, 3100 unless overridden in the caller's environment).
v2-deploy:
	@if git rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then \
		if ! git pull --ff-only; then exit 1; fi; \
	fi; \
	if ! pnpm install --frozen-lockfile; then exit 1; fi; \
	if ! pnpm v2:build; then exit 1; fi; \
	if ! systemctl --user restart "$(V2_SERVICE)"; then exit 1; fi; \
	url="http://127.0.0.1:$${MOJITO2_PORT:-3100}/api/health"; \
	for i in $$(seq 1 30); do \
		if curl -fsS -m 2 "$$url" >/dev/null 2>&1; then \
			echo "OK — $(V2_SERVICE) restarted and healthy"; exit 0; \
		fi; \
		sleep 1; \
	done; \
	echo "$(V2_SERVICE) restarted but $$url did not answer within 30s (journalctl --user -u $(V2_SERVICE))" >&2; \
	exit 1

.PHONY: help start prod restart deploy https https-off install-cli service-install service-uninstall service-restart service-status service-logs v2-install-service v2-deploy
