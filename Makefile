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
	@echo "  make start  dev server (Mac kept awake), prints every URL: local, Wi-Fi, Tailscale"

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

.PHONY: help start
