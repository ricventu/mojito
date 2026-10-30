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
# Do not trust `-e` in a recipe that may run on the Mac — check the exit status
# yourself, as every recipe below does.

## help: list targets
help:
	@echo "Targets:"
	@echo "  make v2-install-service  install and start $(V2_SERVICE) (Mojito v2, port 3100, systemd --user)"
	@echo "  make v2-deploy  v2: git pull --ff-only (if tracked), pnpm install, pnpm v2:build, restart $(V2_SERVICE)"

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
## 30s. It is asked where the server listens: MOJITO2_PORT/MOJITO2_HOST from the caller's
## environment, else the unit's Environment=, else .env.local (the server's own precedence),
## else 3100 on loopback; a wildcard host is reached through 127.0.0.1 (config.ts#selfOrigin).
v2-deploy:
	@if git rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then \
		if ! git pull --ff-only; then exit 1; fi; \
	fi; \
	if ! pnpm install --frozen-lockfile; then exit 1; fi; \
	if ! pnpm v2:build; then exit 1; fi; \
	if ! systemctl --user restart "$(V2_SERVICE)"; then exit 1; fi; \
	unitenv() { systemctl --user show -p Environment --value "$(V2_SERVICE)" 2>/dev/null | tr ' ' '\n' | sed -n "s/^$$1=//p" | tail -n 1; }; \
	dotenv() { sed -n "s/^$$1=//p" .env.local 2>/dev/null | tail -n 1 | tr -d "\"'"; }; \
	port="$${MOJITO2_PORT:-$$(unitenv MOJITO2_PORT)}"; port="$${port:-$$(dotenv MOJITO2_PORT)}"; \
	host="$${MOJITO2_HOST:-$$(unitenv MOJITO2_HOST)}"; host="$${host:-$$(dotenv MOJITO2_HOST)}"; \
	case "$$host" in ""|0.0.0.0|::) host=127.0.0.1 ;; *:*) host="[$$host]" ;; esac; \
	url="http://$$host:$${port:-3100}/api/health"; \
	for i in $$(seq 1 30); do \
		if curl -fsS -m 2 "$$url" >/dev/null 2>&1; then \
			echo "OK — $(V2_SERVICE) restarted and healthy"; exit 0; \
		fi; \
		sleep 1; \
	done; \
	echo "$(V2_SERVICE) restarted but $$url did not answer within 30s (journalctl --user -u $(V2_SERVICE))" >&2; \
	exit 1

.PHONY: help v2-install-service v2-deploy
