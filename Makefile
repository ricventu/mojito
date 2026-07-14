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

# Print the reachable URLs (local, Wi-Fi/LAN, and ngrok if it is running).
# Expects PORT and TOKEN to be set (run $(LOAD_ENV) first). Appends the token
# query so the URL is usable as-is (auth). LAN IP is taken from the default-route
# interface (the one that actually reaches the network), falling back to en0.
SHOW_URLS = Q=""; if [ -n "$$TOKEN" ]; then Q="/?token=$$TOKEN"; fi; \
	IFACE=$$(route -n get default 2>/dev/null | awk '/interface:/{print $$2}'); \
	LAN=$$(ipconfig getifaddr "$$IFACE" 2>/dev/null || ipconfig getifaddr en0 2>/dev/null || true); \
	NG=$$(curl -s --max-time 1 http://localhost:4040/api/tunnels 2>/dev/null | grep -oE '"public_url":"https://[^"]+"' | head -1 | sed -E 's/.*"(https[^"]+)".*/\1/' || true); \
	echo ""; \
	echo "  Local:  http://localhost:$$PORT$$Q"; \
	if [ -n "$$LAN" ]; then echo "  Wi-Fi:  http://$$LAN:$$PORT$$Q   (open on your phone, same Wi-Fi)"; fi; \
	if [ -n "$$NG" ]; then echo "  ngrok:  $$NG$$Q"; fi; \
	echo ""

## help: list targets
help:
	@echo "Targets:"
	@echo "  make start        dev server (Mac kept awake), prints local + Wi-Fi URLs"
	@echo "  make start-ngrok  dev server + ngrok, prints local + Wi-Fi + ngrok URLs"

## start: dev server, Mac kept awake via caffeinate; prints local + Wi-Fi (+ ngrok if already up)
start:
	@$(LOAD_ENV); \
	$(SHOW_URLS); \
	echo "  (Mac kept awake — Ctrl-C to stop)"; \
	echo ""; \
	exec caffeinate -is pnpm dev

## start-ngrok: dev server + ngrok; prints local + Wi-Fi + the public ngrok URL
start-ngrok:
	@$(LOAD_ENV); \
	if [ -z "$$TOKEN" ]; then echo "ERROR: MOJITO_TOKEN missing in .env.local"; exit 1; fi; \
	DEV_PID=""; NGROK_PID=""; \
	trap 'kill $$DEV_PID $$NGROK_PID 2>/dev/null || true' EXIT INT TERM; \
	caffeinate -is pnpm dev & DEV_PID=$$!; \
	ngrok http "$$PORT" --log=stdout > /tmp/mojito-ngrok.log 2>&1 & NGROK_PID=$$!; \
	URL=""; \
	for i in $$(seq 1 30); do \
	  URL=$$(curl -s http://localhost:4040/api/tunnels 2>/dev/null | grep -oE '"public_url":"https://[^"]+"' | head -1 | sed -E 's/.*"(https[^"]+)".*/\1/' || true); \
	  if [ -n "$$URL" ]; then break; fi; \
	  sleep 1; \
	done; \
	if [ -z "$$URL" ]; then echo "ERROR: ngrok did not come up — see /tmp/mojito-ngrok.log"; exit 1; fi; \
	$(SHOW_URLS); \
	wait

.PHONY: help start start-ngrok
