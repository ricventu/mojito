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
	TS=$$(tailscale serve status 2>/dev/null | grep -oE 'https://[^ ]+' | head -1 || true); \
	echo ""; \
	echo "  Local:  http://localhost:$$PORT$$Q"; \
	if [ -n "$$LAN" ]; then echo "  Wi-Fi:  http://$$LAN:$$PORT$$Q   (open on your phone, same Wi-Fi)"; fi; \
	if [ -n "$$NG" ]; then echo "  ngrok:  $$NG$$Q"; fi; \
	if [ -n "$$TS" ]; then echo "  Tailscale: $$TS$$Q   (any network, via VPN)"; fi; \
	echo ""

## help: list targets
help:
	@echo "Targets:"
	@echo "  make start            dev server (Mac kept awake), prints local + Wi-Fi URLs"
	@echo "  make start-ngrok      dev server + ngrok, prints local + Wi-Fi + ngrok URLs"
	@echo "  make start-tailscale  dev server reachable over the tailnet from any network via VPN"

## start: dev server, Mac kept awake via caffeinate; prints local + Wi-Fi (+ ngrok if already up)
start:
	@$(LOAD_ENV); \
	$(SHOW_URLS); \
	echo "  (Mac kept awake — Ctrl-C to stop)"; \
	echo ""; \
	export MOJITO_PORT="$$PORT"; \
	exec caffeinate -is ./scripts/dev-supervisor.sh

## start-ngrok: dev server + ngrok; prints local + Wi-Fi + the public ngrok URL
start-ngrok:
	@$(LOAD_ENV); \
	if [ -z "$$TOKEN" ]; then echo "ERROR: MOJITO_TOKEN missing in .env.local"; exit 1; fi; \
	set -m; DEV_PID=""; NGROK_PID=""; \
	trap 'kill $$DEV_PID $$NGROK_PID 2>/dev/null || true' EXIT INT TERM; \
	MOJITO_PORT="$$PORT" caffeinate -is ./scripts/dev-supervisor.sh & DEV_PID=$$!; \
	ngrok http "$$PORT" --log=stdout > /tmp/mojito-ngrok.log 2>&1 & NGROK_PID=$$!; \
	URL=""; \
	for i in $$(seq 1 30); do \
	  URL=$$(curl -s http://localhost:4040/api/tunnels 2>/dev/null | grep -oE '"public_url":"https://[^"]+"' | head -1 | sed -E 's/.*"(https[^"]+)".*/\1/' || true); \
	  if [ -n "$$URL" ]; then break; fi; \
	  sleep 1; \
	done; \
	if [ -z "$$URL" ]; then echo "ERROR: ngrok did not come up — see /tmp/mojito-ngrok.log"; exit 1; fi; \
	$(SHOW_URLS); \
	wait "$$DEV_PID"

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

.PHONY: help start start-ngrok start-tailscale
