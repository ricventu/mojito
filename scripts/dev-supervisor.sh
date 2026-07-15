#!/usr/bin/env bash
# Health-check supervisor for the Mojito dev server.
#
# Runs `pnpm dev` in its own process group and polls /api/health every
# POLL_INTERVAL seconds. After MAX_FAILURES consecutive failures (a 5xx, or
# no response after the server was first seen responding) it kills the whole
# process group and respawns it. This recovers the "merge in the main
# checkout wedges Next dev" failure (ENOENT .next/required-server-files.json,
# every request 500s until restart) and any other persistent wedge or crash.
#
# No response BEFORE the server was ever seen responding is not a failure:
# the first compile can be slow.
set -u -o pipefail
set -m # job control: background children get their own process group

PORT="${MOJITO_PORT:-4711}"
HEALTH_URL="http://localhost:${PORT}/api/health"
POLL_INTERVAL=5
MAX_FAILURES=3
KILL_GRACE=5

DEV_PID=""

# Kill the dev server's whole process group (pnpm -> tsx -> node), TERM first,
# KILL after KILL_GRACE seconds — an orphaned node child would keep holding
# the port and every respawn would die on EADDRINUSE.
kill_dev() {
  [ -n "$DEV_PID" ] || return 0
  kill -TERM -- "-$DEV_PID" 2>/dev/null || true
  for _ in $(seq 1 "$KILL_GRACE"); do
    if ! kill -0 "$DEV_PID" 2>/dev/null; then
      break
    fi
    # Plain sleep (snooze would re-enter kill_dev): if Ctrl-C lands here the
    # grace loop just shortens; the next snooze catches the shutdown intent.
    sleep 1 || true
  done
  kill -KILL -- "-$DEV_PID" 2>/dev/null || true
  wait "$DEV_PID" 2>/dev/null || true
  DEV_PID=""
}

# Interruptible sleep: under `set -m` the terminal's Ctrl-C (SIGINT) goes to
# the foreground child — this sleep — not to the script, so the INT trap
# alone never sees a keyboard interrupt. A sleep killed by a signal (exit
# status >= 128) therefore means "the user interrupted us": shut down.
snooze() {
  sleep "$1" && return 0
  echo "[supervisor] interrupted — shutting down"
  kill_dev
  exit 0
}

trap 'echo "[supervisor] shutting down"; kill_dev; exit 0' INT TERM

while true; do
  pnpm dev &
  DEV_PID=$!
  echo "[supervisor] dev server started (pid $DEV_PID)"

  seen_up=false
  failures=0

  while [ -n "$DEV_PID" ] && kill -0 "$DEV_PID" 2>/dev/null; do
    snooze "$POLL_INTERVAL"
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL") || true
    [ -n "$code" ] || code=000
    fail=false
    if [ "$code" = "000" ]; then
      # No response: only a failure once the server has responded before —
      # otherwise it is still compiling.
      if [ "$seen_up" = "true" ]; then fail=true; fi
    elif [ "$code" -ge 500 ]; then
      fail=true
    else
      seen_up=true
      failures=0
    fi
    if [ "$fail" = "true" ]; then
      failures=$((failures + 1))
      echo "[supervisor] health check failed (HTTP $code, $failures/$MAX_FAILURES)"
      if [ "$failures" -ge "$MAX_FAILURES" ]; then
        echo "[supervisor] unhealthy after $MAX_FAILURES consecutive checks — restarting dev server"
        kill_dev
      fi
    fi
  done

  # Reap if the child exited on its own (crash) rather than via kill_dev.
  if [ -n "$DEV_PID" ]; then
    wait "$DEV_PID" 2>/dev/null || true
    DEV_PID=""
  fi
  echo "[supervisor] dev server gone — respawning in 2s"
  snooze 2
done
