import { existsSync, mkdirSync } from "node:fs";
import type { Server } from "node:http";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { REPO_ROOT, loadConfig, loadEnvFile } from "./config";
import { openDb } from "./db/db";
import { ProjectsRepo, importProjectsJson } from "./db/projects";
import { SessionsRepo } from "./db/sessions";
import { SettingsRepo } from "./db/settings";
import { TasksRepo } from "./db/tasks";
import { registerEnvKeysAddedSince, snapshotEnvKeys } from "./env/childEnv";
import { EventBus } from "./events/bus";
import { createApp } from "./http/app";
import { LinearClient } from "./linear/client";
import { defaultLaunchIo, type LaunchDeps } from "./sessions/launch";
import { reconcileSessions } from "./sessions/reconcile";
import { linearImageFetcher } from "./tasks/images";
import { TaskQueue } from "./tasks/runner";
import { TicketCache } from "./tickets/cache";
import { PREFIX, closeSession, listSessions } from "./tmux/tmux";
import { startHeartbeat } from "./ws/heartbeat";
import { handleUpgrade } from "./ws/upgrade";

// Last-resort backstops: a stray async error (a ws frame, a hook) is logged, not fatal.
process.on("uncaughtException", (e) => console.error("uncaughtException:", e));
process.on("unhandledRejection", (e) => console.error("unhandledRejection:", e));

async function main(): Promise<void> {
  // Whatever .env.local adds (the token, the Linear key, anything it grows later) is Mojito's
  // own and is scrubbed from every child's environment. The diff must close before the first
  // spawn.
  const beforeEnv = snapshotEnvKeys();
  loadEnvFile(join(REPO_ROOT, ".env.local"));
  registerEnvKeysAddedSince(beforeEnv);

  const cfg = loadConfig();
  mkdirSync(cfg.stateDir, { recursive: true });
  const db = openDb(join(cfg.stateDir, "mojito.db"));
  const projects = new ProjectsRepo(db);
  const settings = new SettingsRepo(db);
  const sessions = new SessionsRepo(db);
  const tasks = new TasksRepo(db);

  if (projects.isEmpty()) {
    const imported = importProjectsJson(projects, cfg.projectsJsonPath);
    if (imported > 0) console.log(`imported ${imported} project(s) from ${cfg.projectsJsonPath}`);
  }
  tasks.failInterrupted(Date.now());

  const bus = new EventBus();
  const linear = new LinearClient(cfg.linearApiKey);
  const tickets = new TicketCache({ linear, projects: () => projects.list().map((p) => p.name), bus });
  const launch: LaunchDeps = { cfg, sessions, projects, bus, linear, tickets, ...defaultLaunchIo() };
  // Nothing is re-enqueued at boot: `failInterrupted` above already failed whatever was in
  // flight, and those are retried from the UI.
  const taskQueue = new TaskQueue({
    tasks,
    projects,
    linear,
    bus,
    tickets,
    query,
    fetchImage: linearImageFetcher(cfg.linearApiKey),
    now: Date.now,
  });

  const { ended, adopted, revived } = await reconcileSessions({
    sessions,
    listTmux: () => listSessions(PREFIX),
    bus,
    now: Date.now,
  });
  if (ended.length + adopted.length + revived.length > 0) {
    console.log(`reconciled sessions: ${ended.length} ended, ${adopted.length} adopted, ${revived.length} revived`);
  }
  tickets.start();

  const webDist = join(cfg.repoRoot, "apps", "web", "dist");
  const staticDir = existsSync(webDist) ? webDist : undefined;
  const app = createApp({
    cfg,
    db,
    projects,
    settings,
    sessions,
    tasks,
    bus,
    linear,
    tickets,
    launch,
    closeSession,
    taskQueue,
    staticDir,
  });

  const server = serve({ fetch: app.fetch, port: cfg.port, hostname: cfg.host }, () => {
    console.log(`Mojito on http://${cfg.host}:${cfg.port}${staticDir ? "" : " (API only: no apps/web/dist)"}`);
  }) as Server;
  // A listen failure (EADDRINUSE: the port is taken, e.g. by the old app) would otherwise leave
  // a process that serves nothing yet keeps polling Linear and holding the database. Exit, so
  // systemd's Restart= (or the human) sees the failure.
  server.on("error", (err) => {
    console.error(`cannot listen on ${cfg.host}:${cfg.port}:`, err);
    process.exit(1);
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  // A socket severed by a NAT/Tailscale idle timeout or a phone in a pocket emits no close, so
  // its pty (a `tmux attach`) would never be released: ping every client, reap the silent ones.
  const stopHeartbeat = startHeartbeat(wss);
  server.on("close", stopHeartbeat);
  server.on("upgrade", (req, socket, head) => handleUpgrade(req, socket, head, { token: cfg.token, wss, sessions, bus }));

  // Stop serving and let go of the database; the tmux sessions are deliberately left alone —
  // they outlive the server, and the next boot reconciles with them. Dropping the sockets
  // only detaches the browser terminals (each pty is a `tmux attach` client).
  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal}: shutting down`);
    tickets.stop();
    for (const ws of wss.clients) ws.terminate();
    server.close(() => {
      db.close();
      process.exit(0);
    });
    server.closeAllConnections();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
