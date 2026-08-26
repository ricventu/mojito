#!/usr/bin/env node
// Health-check + rebuild supervisor for the Mojito PRODUCTION build.
//
// One `next build`, then the resulting server (`pnpm start`) is kept alive: the
// app is served from an optimized build, never from Next's dev server, so page
// loads and renders are fast. Invoked by `make prod`, which wraps it in
// `caffeinate` and prints the reachable URLs.
//
// One loop runs over one child process (`pnpm start`):
//
//   health   poll /api/health every POLL_INTERVAL_MS; after MAX_FAILURES
//            consecutive failures, restart the server (no rebuild — a wedge
//            is a runtime problem, the artifacts are fine). No response
//            BEFORE the server was ever seen responding is not a failure:
//            boot takes a moment.
//
// Editing a file rebuilds NOTHING. There is no source watcher: a rebuild takes
// the app down for its whole duration, and a supervisor whose contract is
// "restart when it stops answering" has no business also taking the server down
// because someone saved a file — least of all in the checkout Mojito's own
// sessions are working in, where writes are constant. A source change reaches
// production only when asked for.
//
// Asking for it is SIGUSR2, which runs pnpm install → stop → build → start, every
// time and in that order. The install is unconditional because a pull can bring a
// lockfile change and nothing here would otherwise notice; on an unchanged tree it
// costs seconds. It runs while the old server is still serving, so a lockfile the
// registry cannot satisfy costs nothing instead of taking the server down for a build
// that was doomed anyway. There is no typecheck step: `next build` type-checks the
// tree itself, and a deploy has nothing to do with a tree that does not compile —
// that belongs to whoever is editing it, before they deploy. Only once it passes do we stop the server, so the rebuild window is
// genuine downtime (~build duration) rather than the server serving a
// half-written `.next`. That signal is what Mojito's "Pull & deploy" button
// sends on macOS (it finds us through the pid we write to
// .prod-supervisor.pid), standing in for the systemd deploy unit the Linux box
// uses. SIGUSR2 rather than SIGHUP because Node exits on an unhandled SIGHUP:
// handling it would turn closing this terminal into a rebuild.

import { spawn } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PORT = process.env.MOJITO_PORT || "4711";
// 127.0.0.1, not localhost: the server binds 0.0.0.0, and `localhost` can
// resolve to ::1 first, which nothing is listening on.
const HEALTH_URL = `http://127.0.0.1:${PORT}/api/health`;

const POLL_INTERVAL_MS = 5_000;
const HEALTH_TIMEOUT_MS = 5_000;
const MAX_FAILURES = 3;
const KILL_GRACE_MS = 5_000;
const RESPAWN_DELAY_MS = 2_000;
// A `.next` that cannot boot at all would otherwise respawn forever.
const MAX_CRASHES = 3;
// Our pid, for whoever wants to ask for a rebuild — read by supervisorPidPath()
// in src/server/selfUpdate.ts. Relative to the repo root we chdir into below.
const PID_FILE = ".prod-supervisor.pid";


// Run from the repo root regardless of where we were invoked from.
process.chdir(fileURLToPath(new URL("..", import.meta.url)));

const log = (msg) => console.log(`[prod-supervisor] ${msg}`);

/** @type {import("node:child_process").ChildProcess | null} */
let server = null;
/** @type {import("node:child_process").ChildProcess | null} */
let oneShot = null; // the in-flight `pnpm install` / `pnpm build`
/** @type {"serving" | "rebuilding" | "down"} */
let state = "down";
let seenUp = false;
let failures = 0;
let crashes = 0;
let stoppingServer = false; // an exit we asked for — not a crash
let shuttingDown = false;
let polling = false; // guards overlapping health polls
let rebuilding = false;
let pendingRebuild = false;
let pollTimer = null;

// --- child process plumbing -------------------------------------------------

// `detached` puts each child in its own process group so we can signal the
// whole tree (pnpm -> tsx -> node, pnpm -> next): an orphaned node would keep
// holding the port and every respawn would die on EADDRINUSE. It also means
// the terminal's Ctrl-C reaches only us, so we forward it deliberately.
// `env` is passed explicitly so the install below can hand us one with NODE_ENV
// stripped. Everything else inherits ours unchanged: `start` needs it (it sets
// NODE_ENV=production itself, through cross-env) and so does `build`.
const spawnPnpm = (args, env = process.env) =>
  spawn("pnpm", args, { stdio: "inherit", detached: true, env });

// The environment for `pnpm install`, with NODE_ENV dropped. Under
// NODE_ENV=production an install strips devDependencies and exits 0 — silently taking
// typescript, tsx and vitest with it, so the `next build` two lines down fails for a
// reason that points nowhere near here (RIC-207). Measured in RIC-240: npm 11 does
// exactly that, pnpm 11 does *not* (it needs an explicit `--prod`). So this is
// belt-and-braces today and cheap insurance against pnpm changing its mind — the cost
// of being wrong is a deploy that half-installs itself and a build nobody can explain.
// We normally inherit no NODE_ENV at all (`make prod` runs us before anything sets it),
// but "normally" is not a guarantee when the value arrives from whatever shell ran us.
function installEnv() {
  const { NODE_ENV: _dropped, ...rest } = process.env;
  return rest;
}

function killGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch {
    /* already gone */
  }
}

function hasExited(proc) {
  return proc.exitCode !== null || proc.signalCode !== null;
}

function waitExit(proc, timeoutMs) {
  if (hasExited(proc)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    proc.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

/** Run a pnpm command to completion. Resolves the exit code (non-zero on signal/spawn error). */
function runOnce(args, label, env) {
  log(`${label}…`);
  return new Promise((resolve) => {
    const proc = spawnPnpm(args, env);
    oneShot = proc;
    const done = (code) => {
      if (oneShot === proc) oneShot = null;
      resolve(code);
    };
    proc.on("error", (err) => {
      console.error(`[prod-supervisor] failed to run \`pnpm ${args.join(" ")}\`:`, err);
      done(1);
    });
    proc.on("exit", (code, signal) => done(signal ? 1 : (code ?? 1)));
  });
}

async function startServer() {
  if (shuttingDown) return;
  const proc = spawnPnpm(["start"]);
  server = proc;
  state = "serving";
  seenUp = false;
  failures = 0;
  log(`server started (pid ${proc.pid}) — waiting for health on ${HEALTH_URL}`);
  proc.on("error", (err) => console.error("[prod-supervisor] server spawn error:", err));
  proc.on("exit", (code, signal) => {
    if (server === proc) server = null;
    onServerExit(code, signal);
  });
}

function onServerExit(code, signal) {
  if (shuttingDown || stoppingServer) return; // we asked for this one
  crashes += 1;
  log(`server exited on its own (code ${code}, signal ${signal}) — crash ${crashes}/${MAX_CRASHES}`);
  if (crashes >= MAX_CRASHES) {
    state = "down";
    log("server keeps dying — the build is probably broken. Staying DOWN; fix it and save a file to retry (or Ctrl-C).");
    return;
  }
  state = "down";
  setTimeout(() => void startServer(), RESPAWN_DELAY_MS);
}

async function stopServer() {
  const proc = server;
  if (!proc) return;
  stoppingServer = true;
  server = null;
  try {
    killGroup(proc.pid, "SIGTERM");
    if (!(await waitExit(proc, KILL_GRACE_MS))) {
      killGroup(proc.pid, "SIGKILL");
      await waitExit(proc, 2_000);
    }
  } finally {
    stoppingServer = false;
  }
}

// --- health loop ------------------------------------------------------------

async function isHealthy() {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    return res.status < 500;
  } catch {
    return false; // no response
  }
}

async function poll() {
  if (polling || shuttingDown) return;
  if (state !== "serving" || !server) return;
  polling = true;
  try {
    if (await isHealthy()) {
      if (!seenUp) {
        seenUp = true;
        crashes = 0;
        log(`healthy — serving the production build on port ${PORT}`);
      }
      failures = 0;
      return;
    }
    // Never responded yet: still booting, not a failure.
    if (!seenUp) return;
    failures += 1;
    log(`health check failed (${failures}/${MAX_FAILURES})`);
    if (failures < MAX_FAILURES) return;
    log(`unhealthy after ${MAX_FAILURES} consecutive checks — restarting the server`);
    await stopServer();
    await startServer();
  } finally {
    polling = false;
  }
}

// --- rebuild, on request only ------------------------------------------------

async function rebuildCycle() {
  // Dependencies first, every time: a pull can bring a lockfile change, and nothing else
  // in this process watches for one. On an unchanged tree `pnpm install` is a no-op of a
  // few seconds — cheap next to a build whose dependencies are missing. The server keeps
  // serving through it (the install is not what takes the app down, the build is), but the
  // health watchdog is held off: pnpm rewriting node_modules under a live server can make
  // it briefly unhealthy, and restarting it mid-install is pure harm.
  const watchdogState = state;
  state = "rebuilding";
  const installed = await runOnce(["install"], "installing dependencies", installEnv());
  state = watchdogState;
  if (installed !== 0) {
    log("pnpm install FAILED — keeping the current build live, nothing rebuilt.");
    return;
  }
  state = "rebuilding";
  log("stopping the server for the rebuild (the app is DOWN until it finishes)");
  await stopServer();
  if ((await runOnce(["build"], "building")) !== 0) {
    log("build FAILED — bringing the server back on whatever is in .next; expect errors until you fix it.");
  }
  crashes = 0; // a fresh build deserves a fresh crash budget
  await startServer();
}

async function triggerRebuild() {
  if (shuttingDown) return;
  if (rebuilding) {
    pendingRebuild = true; // coalesce: rebuild once more when this one lands
    return;
  }
  rebuilding = true;
  try {
    do {
      pendingRebuild = false;
      await rebuildCycle();
    } while (pendingRebuild && !shuttingDown);
  } finally {
    rebuilding = false;
  }
}

// --- lifecycle --------------------------------------------------------------

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${signal} — shutting down`);
  clearInterval(pollTimer);
  // Leave no pid claiming to listen. A SIGKILL still can, hence the liveness probe
  // on the reading side.
  try {
    unlinkSync(PID_FILE);
  } catch {
    /* never written, or already gone */
  }
  if (oneShot) killGroup(oneShot.pid, "SIGTERM"); // a build in flight
  await stopServer();
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => void shutdown(signal));
}

// Only after the initial build: before it there is no server for anyone to ask, and
// triggerRebuild() would race that build (its `rebuilding` guard is not held during it).
// This is now the ONLY way a rebuild ever happens.
function acceptRebuildSignals() {
  try {
    writeFileSync(PID_FILE, `${process.pid}\n`);
  } catch (err) {
    console.error(`[prod-supervisor] cannot write ${PID_FILE} — no on-demand rebuild:`, err);
    return;
  }
  // triggerRebuild() coalesces, so a double-tap on the button costs one extra cycle,
  // never two concurrent builds.
  process.on("SIGUSR2", () => {
    log("SIGUSR2 — rebuild requested");
    void triggerRebuild();
  });
  log(`accepting rebuild requests — SIGUSR2 to pid ${process.pid} (${PID_FILE})`);
}

async function main() {
  if ((await runOnce(["build"], "initial production build")) !== 0) {
    console.error("[prod-supervisor] initial build failed — nothing to serve. Fix the build and rerun `make prod`.");
    process.exit(1);
  }
  acceptRebuildSignals();
  await startServer();
  log("no source watcher — a file change rebuilds nothing; restarts happen only on a failed health check");
  pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);
}

main().catch((err) => {
  console.error("[prod-supervisor]", err);
  process.exit(1);
});
