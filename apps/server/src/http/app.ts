import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { ServerConfig } from "../config";
import type { Db } from "../db/db";
import type { ProjectsRepo } from "../db/projects";
import type { SessionsRepo } from "../db/sessions";
import type { SettingsRepo } from "../db/settings";
import type { TasksRepo } from "../db/tasks";
import type { EventBus } from "../events/bus";
import type { LinearClient } from "../linear/client";
import type { LaunchDeps } from "../sessions/launch";
import type { TaskQueue } from "../tasks/runner";
import type { TicketCache } from "../tickets/cache";
import type { closeSession } from "../tmux/tmux";
import { errorMessage } from "./body";
import { healthRoutes } from "./routes/health";
import { hookRoutes } from "./routes/hook";
import { projectRoutes } from "./routes/projects";
import { sessionRoutes } from "./routes/sessions";
import { settingsRoutes } from "./routes/settings";
import { taskRoutes } from "./routes/tasks";
import { ticketRoutes } from "./routes/tickets";

export interface AppDeps {
  cfg: ServerConfig;
  db: Db;
  projects: ProjectsRepo;
  settings: SettingsRepo;
  sessions: SessionsRepo;
  tasks: TasksRepo;
  bus: EventBus;
  linear: Pick<LinearClient, "listTeamStates" | "setStatus" | "uploadImage">;
  tickets: TicketCache;
  launch: LaunchDeps;
  closeSession: typeof closeSession;
  taskQueue: Pick<TaskQueue, "enqueue" | "retry">;
  /** The built web client; with none, only `/api` is served. */
  staticDir?: string;
  /** Project path validation. Default `fs.existsSync`. */
  exists?(path: string): boolean;
  /** Deletes a session's hook settings file or images dir. Default `fs.rmSync`, recursive. */
  removeFile?(path: string): void;
  now?(): number;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.onError((err, c) => {
    console.error(`${c.req.method} ${c.req.path} failed:`, err);
    return c.json({ error: errorMessage(err) }, 500);
  });

  // Every /api route but health wants the token in a header — /api/hook included, whose curl
  // carries the one written into the session's hook settings. Never from the query string:
  // that is the first-visit handoff the client strips, not a credential the API accepts.
  app.use("/api/*", async (c, next) => {
    if (c.req.path === "/api/health") return next();
    if (c.req.header("x-mojito-token") !== deps.cfg.token) return c.json({ error: "unauthorized" }, 401);
    return next();
  });

  app.route("/api", healthRoutes());
  app.route("/api", hookRoutes(deps));
  app.route("/api", projectRoutes(deps));
  app.route("/api", settingsRoutes(deps));
  app.route("/api", ticketRoutes(deps));
  app.route("/api", sessionRoutes(deps));
  app.route("/api", taskRoutes(deps));

  // Neither falls through to the web client: an unknown API path is an error the caller must
  // see as one, and a plain GET on /ws/* is a WebSocket that failed to upgrade.
  app.all("/api/*", (c) => c.json({ error: "not found" }, 404));
  app.all("/ws/*", (c) => c.json({ error: "not found" }, 404));

  if (deps.staticDir) {
    const root = deps.staticDir;
    app.use("*", serveStatic({ root }));
    // Client-side routes (/session/<id>, …) are the app's own: every other GET gets index.html.
    app.get("*", serveStatic({ root, path: "index.html" }));
  }

  return app;
}
