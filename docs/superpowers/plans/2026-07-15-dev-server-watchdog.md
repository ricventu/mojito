# Dev Server Watchdog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-restart the Mojito dev server when it gets wedged (every request 500s) after a merge in the main checkout.

**Architecture:** A bash supervisor script wraps `pnpm dev`, polls a new unauthenticated `/api/health` route every 5s, and kills/respawns the dev server's process group after 3 consecutive failures. The Makefile `start*` targets run the supervisor instead of `pnpm dev` directly, and `next.config.mjs` suppresses request logging for the health poll.

**Tech Stack:** Next.js 15 (app router route handler), bash (macOS 3.2-compatible), GNU Make 3.81, vitest.

**Spec:** `docs/superpowers/specs/2026-07-15-dev-server-watchdog-design.md`

## Global Constraints

- macOS ships GNU Make 3.81: every Makefile recipe must be a SINGLE logical shell line (backslash-continued), per the note at the top of the Makefile.
- macOS ships bash 3.2: no bash-4+ features in `scripts/dev-supervisor.sh` (no associative arrays, no `${var,,}`).
- Poll interval 5s, failure threshold 3 consecutive, SIGTERM→SIGKILL grace 5s, respawn backoff 2s, port from `MOJITO_PORT` (default 4711).
- Health endpoint is unauthenticated by design.
- All code artifacts in English.
- Test suite: `npx tsc --noEmit && npx vitest run` must pass at every commit.

---

### Task 1: Health endpoint

**Files:**
- Create: `src/app/api/health/route.ts`
- Test: `tests/server/healthRoute.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `GET /api/health` → HTTP 200, body `ok`. Task 2's supervisor polls this exact path.

- [ ] **Step 1: Write the failing test**

Create `tests/server/healthRoute.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  it("returns 200 with body ok", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/healthRoute.test.ts`
Expected: FAIL — cannot resolve `@/app/api/health/route` (file does not exist).

- [ ] **Step 3: Write minimal implementation**

Create `src/app/api/health/route.ts`:

```ts
// Unauthenticated liveness probe for the dev supervisor (scripts/dev-supervisor.sh).
// When Next is wedged (e.g. .next invalidated by a merge in the main checkout),
// every request through the handler 500s — including this one. 200 = alive.
export function GET(): Response {
  return new Response("ok");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/healthRoute.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Typecheck and full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: both pass, no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/health/route.ts tests/server/healthRoute.test.ts
git commit -m "feat(mojito): add /api/health liveness endpoint"
```

---

### Task 2: Supervisor script

**Files:**
- Create: `scripts/dev-supervisor.sh` (mode 755)

**Interfaces:**
- Consumes: `GET /api/health` from Task 1; `MOJITO_PORT` env var (default `4711`), exported by the Makefile in Task 3; `pnpm dev` must be runnable from the repo root (cwd).
- Produces: `scripts/dev-supervisor.sh`, an executable that blocks forever (until INT/TERM) supervising the dev server. Task 3's Makefile invokes it as `./scripts/dev-supervisor.sh`.

- [ ] **Step 1: Write the script**

Create `scripts/dev-supervisor.sh`:

```bash
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
    sleep 1
  done
  kill -KILL -- "-$DEV_PID" 2>/dev/null || true
  wait "$DEV_PID" 2>/dev/null || true
  DEV_PID=""
}

trap 'echo "[supervisor] shutting down"; kill_dev; exit 0' INT TERM

while true; do
  pnpm dev &
  DEV_PID=$!
  echo "[supervisor] dev server started (pid $DEV_PID)"

  seen_up=false
  failures=0

  while [ -n "$DEV_PID" ] && kill -0 "$DEV_PID" 2>/dev/null; do
    sleep "$POLL_INTERVAL"
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
  sleep 2
done
```

- [ ] **Step 2: Make it executable and syntax-check**

Run: `chmod +x scripts/dev-supervisor.sh && bash -n scripts/dev-supervisor.sh && echo SYNTAX_OK`
Expected: `SYNTAX_OK`, no other output.

- [ ] **Step 3: Smoke-test the restart loop without Next**

The one mechanism worth checking in isolation is the process-group kill (`set -m` + negative-PID kill), since an orphaned child is the failure mode that causes EADDRINUSE churn:

```bash
bash -c 'set -m; sleep 300 & DEV_PID=$!; kill -TERM -- "-$DEV_PID"; wait "$DEV_PID" 2>/dev/null; echo "GROUP_KILL_OK"'
```

Expected: `GROUP_KILL_OK` — confirms group kill works on this macOS/bash.

(Full end-to-end behavior — healthy polling, wedge detection, restart, Ctrl-C cleanup — is verified in Task 4 with the real server.)

- [ ] **Step 4: Commit**

```bash
git add scripts/dev-supervisor.sh
git commit -m "feat(mojito): add dev-server health-check supervisor"
```

---

### Task 3: Wire supervisor into Makefile and silence health-poll logs

**Files:**
- Modify: `Makefile` (targets `start`, `start-ngrok`, `start-tailscale` — lines 38-43, 46-61, 68-77)
- Modify: `next.config.mjs`

**Interfaces:**
- Consumes: `./scripts/dev-supervisor.sh` from Task 2; `LOAD_ENV` Makefile snippet (already sets `PORT` from `.env.local`/default).
- Produces: `make start`, `make start-ngrok`, `make start-tailscale` run the supervisor with `MOJITO_PORT` exported. `next.config.mjs` stops logging `GET /api/health` request lines.

- [ ] **Step 1: Add logging suppression to next.config.mjs**

In `next.config.mjs`, add a `logging` key to `nextConfig` (above the `webpack` key):

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The dev supervisor polls /api/health every 5s — keep it out of the
  // request log so the dev console stays readable.
  logging: {
    incomingRequests: {
      ignore: [/\/api\/health/],
    },
  },
  // src/server/**/*.ts uses ESM-style ".js" specifiers for local imports
```

(The existing `webpack` block and the rest of the file stay unchanged.)

- [ ] **Step 2: Swap `pnpm dev` for the supervisor in the three Makefile targets**

All three recipes must stay single logical shell lines (Global Constraints). `LOAD_ENV` already sets `PORT`, so export it as `MOJITO_PORT` right before invoking the supervisor.

`start` (currently `exec caffeinate -is pnpm dev`):

```makefile
## start: dev server, Mac kept awake via caffeinate; prints local + Wi-Fi (+ ngrok if already up)
start:
	@$(LOAD_ENV); \
	$(SHOW_URLS); \
	echo "  (Mac kept awake — Ctrl-C to stop)"; \
	echo ""; \
	export MOJITO_PORT="$$PORT"; \
	exec caffeinate -is ./scripts/dev-supervisor.sh
```

`start-ngrok` (currently `caffeinate -is pnpm dev & DEV_PID=$$!`): replace only that line —

```makefile
	MOJITO_PORT="$$PORT" caffeinate -is ./scripts/dev-supervisor.sh & DEV_PID=$$!; \
```

`start-tailscale` (currently `exec caffeinate -is pnpm dev`): replace only that line —

```makefile
	export MOJITO_PORT="$$PORT"; \
	exec caffeinate -is ./scripts/dev-supervisor.sh
```

- [ ] **Step 3: Verify the Makefile still parses and the suite still passes**

Run: `make help && npx tsc --noEmit && npx vitest run`
Expected: `make help` prints the three targets; typecheck and tests pass.

- [ ] **Step 4: Commit**

```bash
git add Makefile next.config.mjs
git commit -m "feat(mojito): run dev server under health-check supervisor"
```

---

### Task 4: End-to-end manual verification

**Files:** none (manual QA of the wired system; fixes discovered here are committed as `fix(mojito): …`).

**Interfaces:**
- Consumes: everything from Tasks 1-3.
- Produces: confirmation the spec's Testing section holds.

- [ ] **Step 1: Healthy operation**

Run `make start` in a terminal. Expected within ~30s: `[supervisor] dev server started (pid …)`, the usual `Mojito on http://0.0.0.0:4711` line, and `curl -s http://localhost:4711/api/health` prints `ok`. Watch the console for ~30s: NO `GET /api/health` request-log lines appear (logging suppression works), and no `[supervisor] health check failed` lines.

- [ ] **Step 2: Wedge detection and auto-restart**

With the server running and healthy, simulate the post-merge wedge:

```bash
pkill -STOP -f "server.ts"
```

(SIGSTOP freezes the tsx watcher AND its node child — health polls time out with `000` after `seen_up`, same failure path as persistent 500s. Stopped processes ignore SIGTERM, so this also exercises the supervisor's SIGKILL fallback. Alternatively delete `.next/routes-manifest.json` and hit the UI until it 500s.)

Expected within ~20-30s: three `[supervisor] health check failed (HTTP 000, n/3)` lines, then `[supervisor] unhealthy after 3 consecutive checks — restarting dev server`, then `[supervisor] dev server started`, and `curl -s http://localhost:4711/api/health` prints `ok` again. The web UI recovers on reload.

- [ ] **Step 3: Ctrl-C cleanup**

Press Ctrl-C in the `make start` terminal. Expected: `[supervisor] shutting down`, prompt returns.

Run: `pgrep -f "tsx watch server.ts" || echo CLEAN; lsof -ti :4711 || echo PORT_FREE`
Expected: `CLEAN` and `PORT_FREE` — no orphaned processes, port released.

- [ ] **Step 4: Lime sessions survive a restart (spot check)**

If any `mojito-*` tmux session exists (`tmux ls`), confirm after a supervisor restart (Step 2) that `tmux ls` still shows it and the session reappears in the web UI (registry `recover()` on boot).
