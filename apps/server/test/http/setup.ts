import { vi } from "vitest";
import type { MojitoEvent, SessionMeta } from "@mojito/shared";
import type { ServerConfig } from "../../src/config";
import { openDb } from "../../src/db/db";
import { ProjectsRepo } from "../../src/db/projects";
import { SessionsRepo } from "../../src/db/sessions";
import { SettingsRepo } from "../../src/db/settings";
import { TasksRepo } from "../../src/db/tasks";
import { EventBus } from "../../src/events/bus";
import { createApp, type AppDeps } from "../../src/http/app";
import type { LaunchDeps } from "../../src/sessions/launch";
import { TicketCache } from "../../src/tickets/cache";

export const TOKEN = "tok";

export const cfg: ServerConfig = {
  port: 3100,
  host: "0.0.0.0",
  token: TOKEN,
  linearApiKey: "key",
  stateDir: "/state",
  repoRoot: "/mojito",
  projectsJsonPath: "/cfg/projects.json",
  home: "/home/me",
};

export const meta = (over: Partial<SessionMeta> = {}): SessionMeta => ({
  id: "mj-RIC-1",
  kind: "ticket",
  project: "Web",
  ticket: "RIC-1",
  cwd: "/repo/web",
  model: "opus",
  effort: "high",
  state: "running",
  alert: null,
  createdAt: 1,
  lastEventAt: 1,
  ...over,
});

/** The whole app over an in-memory database, with Linear, tmux and the filesystem faked. */
export function setup(over: Partial<AppDeps> = {}) {
  const db = openDb(":memory:");
  const projects = new ProjectsRepo(db);
  const settings = new SettingsRepo(db);
  const sessions = new SessionsRepo(db);
  const tasks = new TasksRepo(db);
  const bus = new EventBus();
  const events: MojitoEvent[] = [];
  bus.subscribe((e) => events.push(e));
  const linear = {
    listOpenIssues: vi.fn(async () => []),
    listTeamStates: vi.fn(async (_team: string) => ["Backlog", "Todo", "In Progress"]),
    setStatus: vi.fn(async (_id: string, _status: string) => {}),
    assignToMe: vi.fn(async (_id: string) => {}),
    uploadImage: vi.fn(async (_file: { filename: string; contentType: string; size: number; bytes: Uint8Array }) => "https://uploads.linear.app/x"),
  };
  const tickets = new TicketCache({ linear, projects: () => projects.list().map((p) => p.name), bus });
  const refresh = vi.spyOn(tickets, "refresh");
  const launch: LaunchDeps = {
    cfg,
    sessions,
    projects,
    bus,
    linear,
    tickets,
    newSession: vi.fn(async () => {}),
    hasSession: vi.fn(async () => true),
    exists: () => true,
    writeFile: vi.fn(),
    now: () => 1000,
    randomHex: () => "a1b2c3",
  };
  const closeSession = vi.fn(async (_name: string) => ({ closed: true }));
  const exists = vi.fn((_path: string) => true);
  const removeFile = vi.fn((_path: string) => {});
  const taskQueue = { enqueue: vi.fn((_id: string) => {}), retry: vi.fn((_id: string) => false) };
  const deps: AppDeps = {
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
    exists,
    removeFile,
    now: () => 2000,
    ...over,
  };
  const app = createApp(deps);

  /** An authenticated request; `json` becomes the body. */
  const req = (path: string, init: { method?: string; json?: unknown; headers?: Record<string, string> } = {}) =>
    app.request(path, {
      method: init.method ?? "GET",
      headers: {
        "x-mojito-token": TOKEN,
        ...(init.json !== undefined ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
      ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}),
    });

  return { app, req, deps, db, projects, settings, sessions, tasks, bus, events, linear, tickets, refresh, launch, closeSession, taskQueue, exists, removeFile };
}
