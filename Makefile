SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

# NOTE: macOS ships GNU Make 3.81, which ignores `.ONESHELL:` (added in 3.82).
# So each recipe must run as a SINGLE logical shell line (backslash-continued),
# otherwise every physical line runs in its own shell and variables set on one
# line are gone on the next.
#
# `.SHELLFLAGS` landed in 3.82 as well, so it is likewise ignored there: on macOS
# these recipes run under a plain `/bin/bash -c` with NO `-e`, and a command that
# fails mid-recipe is walked straight past with the target still reporting success.
# Do not trust `-e` in a recipe that may run on the Mac — check the exit status
# yourself, as every recipe below does.

## help: list targets
help:
	@echo "Targets:"
	@echo "  make install-service  install and start the service (systemd --user on Linux, LaunchAgent on macOS)"
	@echo "  make deploy  git pull --ff-only (if tracked), pnpm install, pnpm build, restart the service"

## install-service: Mojito (apps/server + apps/web) as a systemd user unit on Linux, or as
## the com.mojito.server LaunchAgent on macOS (deploy/launchd.sh, run it from the shell you
## use Mojito from: its PATH and locale are baked into the plist). The unit's
## WorkingDirectory is ~/code/mojito, so run this from there, after `pnpm build`: an unbuilt
## checkout is refused rather than installed as a unit that crash-loops on a missing
## dist/main.js. Every command's exit status is checked by hand: make 3.81 ignores
## .SHELLFLAGS, so there is no `-e` to lean on (see the header note).
SERVICE ?= mojito.service
UNIT_DIR ?= $(HOME)/.config/systemd/user
UNAME := $(shell uname -s)
install-service:
	@if [ "$(UNAME)" = Darwin ]; then \
		if ! deploy/launchd.sh install; then exit 1; fi; \
		exit 0; \
	fi; \
	if [ ! -f apps/server/dist/main.js ]; then \
		echo "apps/server/dist/main.js is missing: run 'pnpm build' first (in ~/code/mojito)" >&2; \
		exit 1; \
	fi; \
	if ! mkdir -p "$(UNIT_DIR)"; then exit 1; fi; \
	if ! cp deploy/mojito.service "$(UNIT_DIR)/$(SERVICE)"; then exit 1; fi; \
	if ! systemctl --user daemon-reload; then exit 1; fi; \
	if ! systemctl --user enable "$(SERVICE)"; then exit 1; fi; \
	if ! systemctl --user restart "$(SERVICE)"; then exit 1; fi; \
	echo "OK — $(SERVICE) installed and started (status: systemctl --user status $(SERVICE))"

## deploy: update Mojito in place and restart it. Run it from the checkout the service serves
## (~/code/mojito on the box). On macOS the restart rewrites the LaunchAgent's plist, so a
## node switched under nvm is picked up together with the modules just built for it. The pull runs only when the branch tracks a remote. Each step aborts the
## deploy, so a failed pull, install or build never replaces the running server. The install
## is --frozen-lockfile: a lockfile out of step with the manifests is a broken commit, not
## something to re-resolve on the server. A restart is not a success until /api/health
## answers, which it must within 30s. It is asked where the server listens:
## MOJITO_PORT/MOJITO_HOST from the caller's environment, else the unit's Environment=, else
## .env.local (the server's own precedence), else 8700 on loopback; a wildcard host is
## reached through 127.0.0.1 (config.ts#selfOrigin).
deploy:
	@if git rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then \
		if ! git pull --ff-only; then exit 1; fi; \
	fi; \
	if ! pnpm install --frozen-lockfile; then exit 1; fi; \
	if ! pnpm build; then exit 1; fi; \
	if [ "$(UNAME)" = Darwin ]; then \
		if ! deploy/launchd.sh restart; then exit 1; fi; \
		logs="$(HOME)/Library/Logs/Mojito/mojito.log"; \
	else \
		if ! systemctl --user restart "$(SERVICE)"; then exit 1; fi; \
		logs="journalctl --user -u $(SERVICE)"; \
	fi; \
	unitenv() { systemctl --user show -p Environment --value "$(SERVICE)" 2>/dev/null | tr ' ' '\n' | sed -n "s/^$$1=//p" | tail -n 1; }; \
	dotenv() { sed -n "s/^$$1=//p" .env.local 2>/dev/null | tail -n 1 | tr -d "\"'"; }; \
	port="$${MOJITO_PORT:-$$(unitenv MOJITO_PORT)}"; port="$${port:-$$(dotenv MOJITO_PORT)}"; \
	host="$${MOJITO_HOST:-$$(unitenv MOJITO_HOST)}"; host="$${host:-$$(dotenv MOJITO_HOST)}"; \
	case "$$host" in ""|0.0.0.0|::) host=127.0.0.1 ;; *:*) host="[$$host]" ;; esac; \
	url="http://$$host:$${port:-8700}/api/health"; \
	for i in $$(seq 1 30); do \
		if curl -fsS -m 2 "$$url" >/dev/null 2>&1; then \
			echo "OK — Mojito restarted and healthy"; exit 0; \
		fi; \
		sleep 1; \
	done; \
	echo "Mojito restarted but $$url did not answer within 30s ($$logs)" >&2; \
	exit 1

.PHONY: help install-service deploy
