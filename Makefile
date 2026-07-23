SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

# NOTE: macOS ships GNU Make 3.81, which ignores `.ONESHELL:` (added in 3.82).
# So each recipe must run as a SINGLE logical shell line (backslash-continued),
# otherwise every physical line runs in its own shell and variables set on one
# line are gone on the next. The `=` (recursive) snippet vars below keep their
# `$$` until they are expanded into a recipe, so they compose correctly.

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
	@echo "  make restart  prod deploy: next build, then restart $(SERVICE) (systemd --user) + health check"

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

## restart: rebuild the Next app (next build) then restart the systemd user service
## and wait for /api/health. Production deploy path on the Linux box (NOT `make start`,
## which is the macOS dev supervisor). A failed build aborts before the restart
## (SHELLFLAGS -e), so the running server is never replaced by a broken build.
restart:
	@echo "==> Building (next build)…"; \
	npm run build; \
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

.PHONY: help start restart
