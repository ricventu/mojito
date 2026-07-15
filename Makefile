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

# Print the reachable URLs (local, Wi-Fi/LAN, and Tailscale Serve if enabled).
# Expects PORT and TOKEN to be set (run $(LOAD_ENV) first). Appends the token
# query so the URL is usable as-is (auth). LAN IP is taken from the default-route
# interface (the one that actually reaches the network), falling back to en0.
SHOW_URLS = Q=""; if [ -n "$$TOKEN" ]; then Q="/?token=$$TOKEN"; fi; \
	IFACE=$$(route -n get default 2>/dev/null | awk '/interface:/{print $$2}'); \
	LAN=$$(ipconfig getifaddr "$$IFACE" 2>/dev/null || ipconfig getifaddr en0 2>/dev/null || true); \
	TS=$$(tailscale serve status 2>/dev/null | grep -oE 'https://[^ ]+' | head -1 || true); \
	echo ""; \
	echo "  Local:  http://localhost:$$PORT$$Q"; \
	if [ -n "$$LAN" ]; then echo "  Wi-Fi:  http://$$LAN:$$PORT$$Q   (open on your phone, same Wi-Fi)"; fi; \
	if [ -n "$$TS" ]; then echo "  Tailscale: $$TS$$Q   (any network, via VPN)"; fi; \
	echo ""

## help: list targets
help:
	@echo "Targets:"
	@echo "  make start            dev server (Mac kept awake), prints local + Wi-Fi URLs"
	@echo "  make start-tailscale  dev server reachable over the tailnet from any network via VPN"

## start: dev server, Mac kept awake via caffeinate; prints local + Wi-Fi URLs
start:
	@$(LOAD_ENV); \
	$(SHOW_URLS); \
	echo "  (Mac kept awake — Ctrl-C to stop)"; \
	echo ""; \
	export MOJITO_PORT="$$PORT"; \
	exec caffeinate -is ./scripts/dev-supervisor.sh

## start-tailscale: dev server reachable over the tailnet from any network. The server
## already binds 0.0.0.0, so the phone (on the same tailnet) hits the Mac's tailnet IP
## directly — traffic is WireGuard-encrypted, no public exposure. No HTTPS/Serve needed.
## (For a pretty HTTPS hostname instead, enable Serve in the tailnet admin console and use
## `tailscale serve --bg $(PORT)` — but that requires the Serve feature to be turned on.)
start-tailscale:
	@$(LOAD_ENV); \
	TSIP=$$(tailscale ip -4 2>/dev/null | head -1 || true); \
	if [ -z "$$TSIP" ]; then echo "ERROR: Tailscale is not up — run: sudo tailscale up"; exit 1; fi; \
	Q=""; if [ -n "$$TOKEN" ]; then Q="/?token=$$TOKEN"; fi; \
	echo ""; \
	echo "  Tailscale: http://$$TSIP:$$PORT$$Q   (open on your phone, any network, via VPN)"; \
	echo "  (Mac kept awake — Ctrl-C to stop)"; \
	echo ""; \
	export MOJITO_PORT="$$PORT"; \
	exec caffeinate -is ./scripts/dev-supervisor.sh

.PHONY: help start start-tailscale
