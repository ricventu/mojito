#!/usr/bin/env node
// Health-check + rebuild supervisor for the Mojito PRODUCTION build.
//
// Same conveniences as scripts/dev-supervisor.sh (auto-restart on a wedge,
// picks up source changes) but the app is served from an optimized
// `next build` instead of Next's dev server, so page loads and renders are
// fast. Invoked by `make prod`, which wraps it in `caffeinate` and prints the
// reachable URLs.
//
// Two loops run over one child process (`npm start`):
//
//   health   poll /api/health every POLL_INTERVAL_MS; after MAX_FAILURES
//            consecutive failures, restart the server (no rebuild — a wedge
//            is a runtime problem, the artifacts are fine). No response
//            BEFORE the server was ever seen responding is not a failure:
//            boot takes a moment.
//
//   rebuild  watch the sources; on change, typecheck → stop → build → start.
//            The typecheck runs FIRST, while the old server is still serving:
//            a typo therefore costs nothing, instead of taking the server
//            down for a build that was doomed anyway. Only once it passes do
//            we stop the server, so the rebuild window is genuine downtime
//            (~build duration) rather than the server serving a half-written
//            `.next`.
//
// The rebuild cycle is also reachable on demand: SIGUSR2 runs it even when nothing
// changed. That is what Mojito's "Pull & deploy" button signals on macOS (it finds
// us through the pid we write to .prod-supervisor.pid), standing in for the systemd
// deploy unit the Linux box uses. SIGUSR2 rather than SIGHUP because Node exits on
// an unhandled SIGHUP: handling it would turn closing this terminal into a rebuild.
//
// Written in JS rather than bash (unlike the dev supervisor) because the file
// watching needs `fs.watch({recursive})` — macOS has no `fswatch` by default.

import { spawn } from "node:child_process";
import { unlinkSync, watch, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PORT = process.env.MOJITO_PORT || "4711";
// 127.0.0.1, not localhost: the server binds 0.0.0.0, and `localhost` can
// resolve to ::1 first, which nothing is listening on.
const HEALTH_URL = `http://127.0.0.1:${PORT}/api/health`;

const POLL_INTERVAL_MS = 5_000;
const HEALTH_TIMEOUT_MS = 5_000;
const MAX_FAILURES = 3;
// Coalesce a burst of writes (a save-all, a `git pull`, a branch switch) into
// one rebuild. Long-ish because a rebuild is expensive and takes the server
// down — better to wait than to build twice.
const DEBOUNCE_MS = 1_500;
const KILL_GRACE_MS = 5_000;
const RESPAWN_DELAY_MS = 2_000;
// A `.next` that cannot boot at all would otherwise respawn forever.
const MAX_CRASHES = 3;
// Our pid, for whoever wants to ask for a rebuild — read by supervisorPidPath()
// in src/server/selfUpdate.ts. Relative to the repo root we chdir into below.
const PID_FILE = ".prod-supervisor.pid";

// Root-level files worth a rebuild, watched via the (non-recursive) root
// watcher rather than individually: editors replace files by rename, which
// detaches a per-file fs.watch from the new inode.
const ROOT_FILES = new Set([
  "server.ts",
  "next.config.mjs",
  "tailwind.config.ts",
  "postcss.config.mjs",
  "package.json",
  "tsconfig.json",
]);
const SOURCE_EXT = /\.(?:ts|tsx|js|jsx|mjs|cjs|css|json)$/;

// public/ is deliberately NOT watched: Next serves it straight from disk at
// runtime, so an asset change needs no rebuild.
const WATCH_TARGETS = [
  { path: ".", recursive: false, wanted: (f) => ROOT_FILES.has(f) },
  { path: "src", recursive: true, wanted: (f) => SOURCE_EXT.test(f) },
];

// Run from the repo root regardless of where we were invoked from.
process.chdir(fileURLToPath(new URL("..", import.meta.url)));

const log = (msg) => console.log(`[prod-supervisor] ${msg}`);

/** @type {import("node:child_process").ChildProcess | null} */
let server = null;
/** @type {import("node:child_process").ChildProcess | null} */
let oneShot = null; // the in-flight `npm run typecheck` / `npm run build`
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
let rebuildTimer = null;
let pollTimer = null;
const watchers = [];

// --- child process plumbing -------------------------------------------------

// `detached` puts each child in its own process group so we can signal the
// whole tree (npm -> tsx -> node, npm -> next): an orphaned node would keep
// holding the port and every respawn would die on EADDRINUSE. It also means
// the terminal's Ctrl-C reaches only us, so we forward it deliberately.
const spawnNpm = (args) =>
  spawn("npm", args, { stdio: "inherit", detached: true, env: process.env });

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

/** Run an npm script to completion. Resolves the exit code (non-zero on signal/spawn error). */
function runOnce(args, label) {
  log(`${label}…`);
  return new Promise((resolve) => {
    const proc = spawnNpm(args);
    oneShot = proc;
    const done = (code) => {
      if (oneShot === proc) oneShot = null;
      resolve(code);
    };
    proc.on("error", (err) => {
      console.error(`[prod-supervisor] failed to run \`npm ${args.join(" ")}\`:`, err);
      done(1);
    });
    proc.on("exit", (code, signal) => done(signal ? 1 : (code ?? 1)));
  });
}

async function startServer() {
  if (shuttingDown) return;
  const proc = spawnNpm(["start"]);
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

// --- rebuild loop -----------------------------------------------------------

async function rebuildCycle() {
  // Typecheck while the old server is still up: a broken tree costs no downtime.
  if ((await runOnce(["run", "typecheck"], "change detected — typechecking")) !== 0) {
    log("typecheck FAILED — keeping the current build live, nothing rebuilt.");
    return;
  }
  state = "rebuilding";
  log("typecheck OK — stopping the server for the rebuild (the app is DOWN until it finishes)");
  await stopServer();
  if ((await runOnce(["run", "build"], "building")) !== 0) {
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

function startWatchers() {
  for (const { path, recursive, wanted } of WATCH_TARGETS) {
    try {
      const w = watch(path, { recursive }, (_event, filename) => {
        if (!filename) return;
        // Recursive watches report a path relative to the watched root.
        const base = filename.split("/").pop() ?? filename;
        if (!wanted(recursive ? filename : base)) return;
        clearTimeout(rebuildTimer);
        rebuildTimer = setTimeout(() => void triggerRebuild(), DEBOUNCE_MS);
      });
      w.on("error", (err) => console.error(`[prod-supervisor] watcher on ${path} failed:`, err));
      watchers.push(w);
    } catch (err) {
      console.error(`[prod-supervisor] cannot watch ${path} — no auto-rebuild from it:`, err);
    }
  }
  log(`watching ${WATCH_TARGETS.map((t) => t.path).join(", ")} — a change triggers typecheck + rebuild`);
}

// --- lifecycle --------------------------------------------------------------

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${signal} — shutting down`);
  clearTimeout(rebuildTimer);
  clearInterval(pollTimer);
  for (const w of watchers) w.close();
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
  if ((await runOnce(["run", "build"], "initial production build")) !== 0) {
    console.error("[prod-supervisor] initial build failed — nothing to serve. Fix the build and rerun `make prod`.");
    process.exit(1);
  }
  acceptRebuildSignals();
  await startServer();
  startWatchers();
  pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);
}

main().catch((err) => {
  console.error("[prod-supervisor]", err);
  process.exit(1);
});
