#!/usr/bin/env bash
# What the macOS LaunchAgent runs (see scripts/launchd-service.sh, which installs it):
# `make prod` without the terminal — the same prod supervisor, kept alive by launchd.
#
# Two things differ from `make prod`, both on purpose.
#
# Only MOJITO_PORT is read out of .env.local, in a subshell, rather than the whole file
# exported. The supervisor needs the port for its health URL and nothing else; the server
# loads .env.local itself, and `registerEnvFileKeys` can only scrub the keys it watched
# arrive *in that load* — a LINEAR_API_KEY already in the environment when the server
# boots counts as the user's own and would ride into every session (RIC-207).
#
# caffeinate watches our pid instead of wrapping node. Wrapped, caffeinate would be the
# job's process, so launchd's SIGTERM on stop/restart would land on it instead of on the
# supervisor — which would never run its shutdown and leave the server (its own process
# group, by design) holding the port. `-w $$` survives the exec below: it is the same pid.
set -u -o pipefail
cd "$(dirname "$0")/.."

MOJITO_PORT=$(
  set -a
  # shellcheck disable=SC1091
  [ -f .env.local ] && . ./.env.local >/dev/null 2>&1
  printf '%s' "${MOJITO_PORT:-4711}"
)
export MOJITO_PORT

echo "[launchd-run] $(date '+%Y-%m-%d %H:%M:%S') starting the prod supervisor on port $MOJITO_PORT"
/usr/bin/caffeinate -is -w $$ &
exec node ./scripts/prod-supervisor.mjs
