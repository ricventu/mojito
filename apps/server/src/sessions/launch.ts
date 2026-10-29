import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { LaunchTicketBody, type Effort, type LaunchFreeBody, type Model, type Prompts, type SessionMeta } from "@mojito/shared";
import { selfOrigin, type ServerConfig } from "../config";
import type { ProjectsRepo } from "../db/projects";
import type { SessionsRepo } from "../db/sessions";
import type { EventBus } from "../events/bus";
import { expandHome } from "../homePath";
import type { LinearClient } from "../linear/client";
import type { TicketCache } from "../tickets/cache";
import { DuplicateSessionError, PREFIX, hasSession, newSession, q } from "../tmux/tmux";
import { buildHookSettings } from "./hookSettings";
import { buildTicketPrompt } from "./prompt";
import { watchStartupStall } from "./startupStall";

export interface LaunchDeps {
  cfg: ServerConfig;
  sessions: SessionsRepo;
  projects: ProjectsRepo;
  bus: EventBus;
  linear: Pick<LinearClient, "setStatus" | "assignToMe">;
  tickets: Pick<TicketCache, "get" | "refresh">;
  newSession: typeof newSession;
  hasSession(name: string): Promise<boolean>;
  exists(path: string): boolean;
  writeFile(path: string, data: string): void;
  now(): number;
  randomHex(): string;
  /** The prompts as Settings has them now: read on every launch, so an edit needs no restart. */
  prompts(): Prompts;
}

export type LaunchResult =
  | { ok: true; session: SessionMeta; warning?: string }
  | { ok: false; status: 400 | 404 | 409; error: string; sessionId?: string };

type LaunchIo = Pick<LaunchDeps, "newSession" | "hasSession" | "exists" | "writeFile" | "now" | "randomHex">;

/** The real-world half of `LaunchDeps`: tmux, the filesystem, the clock and the id source. */
export function defaultLaunchIo(): LaunchIo {
  return {
    newSession,
    hasSession,
    exists: existsSync,
    writeFile: (path, data) => {
      mkdirSync(dirname(path), { recursive: true });
      // The hook commands carry MOJITO_TOKEN: owner-only.
      writeFileSync(path, data, { mode: 0o600 });
    },
    now: Date.now,
    randomHex: () => randomBytes(3).toString("hex"),
  };
}

// Ids a launch is between its checks and its row insert. A second launch for the same
// ticket in that window (a double tap on Launch) is answered 409 instead of racing to tmux.
const launching = new Set<string>();

const conflict = (id: string): LaunchResult => ({
  ok: false,
  status: 409,
  error: `session already exists: ${id}`,
  sessionId: id,
});

// `exists` resolves a relative path against Mojito's cwd, tmux's `-c` against the tmux
// server's: the two can disagree, so only an absolute path can be trusted to mean one place.
const usableDir = (deps: LaunchDeps, path: string) => isAbsolute(path) && deps.exists(path);

const hookSettingsPath = (cfg: ServerConfig, id: string) => join(cfg.stateDir, "hooks", `${id}.json`);

function claudeCommand(model: Model, effort: Effort, settingsPath: string, prompt?: string): string {
  const base = `claude --model ${q(model)} --effort ${q(effort)} --settings ${q(settingsPath)}`;
  return prompt === undefined ? base : `${base} ${q(prompt)}`;
}

// A shell session is the user's login shell, in place of the tmux pane's own.
const SHELL_COMMAND = 'exec "${SHELL:-/bin/bash}" -l';

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** `newSession`, with tmux's "name taken" answered as the 409 a launch reports. */
async function spawn(deps: LaunchDeps, id: string, cwd: string, command: string): Promise<LaunchResult | null> {
  try {
    await deps.newSession(id, cwd, command);
    return null;
  } catch (err) {
    if (err instanceof DuplicateSessionError) return conflict(id);
    throw err;
  }
}

function record(deps: LaunchDeps, session: SessionMeta): void {
  deps.sessions.insert(session);
  deps.bus.emit({ type: "session.updated", session });
}

const stallDeps = (deps: LaunchDeps) => ({ sessions: deps.sessions, bus: deps.bus, hasSession: deps.hasSession });

export async function launchTicket(body: LaunchTicketBody, deps: LaunchDeps): Promise<LaunchResult> {
  // The id names the tmux session and is interpolated into the hook commands, so it is
  // checked here too, not only by the route's schema.
  if (!LaunchTicketBody.shape.ticket.safeParse(body.ticket).success) {
    return { ok: false, status: 400, error: `invalid ticket id: ${body.ticket}` };
  }
  const ticket = deps.tickets.get(body.ticket);
  if (!ticket) return { ok: false, status: 404, error: `ticket not found: ${body.ticket}` };
  if (ticket.project === null) return { ok: false, status: 400, error: `ticket has no project: ${body.ticket}` };
  const project = deps.projects.get(ticket.project);
  if (!project) return { ok: false, status: 400, error: `project not mapped: ${ticket.project}` };
  const cwd = expandHome(project.path, deps.cfg.home);
  if (!usableDir(deps, cwd)) return { ok: false, status: 400, error: `project path not found: ${cwd}` };

  const id = `${PREFIX}${body.ticket}`;
  if (launching.has(id)) return conflict(id);
  launching.add(id);
  try {
    const live = deps.sessions.liveForTicket(body.ticket);
    if (live) {
      if (await deps.hasSession(live.id)) return conflict(live.id);
      // The row outlived its tmux (a crash Mojito missed): end it and launch afresh.
      const ended = deps.sessions.patch(live.id, { state: "ended" });
      if (ended) deps.bus.emit({ type: "session.updated", session: ended });
    }

    const settingsPath = hookSettingsPath(deps.cfg, id);
    deps.writeFile(settingsPath, JSON.stringify(buildHookSettings(id, selfOrigin(deps.cfg), deps.cfg.token)));
    const command = claudeCommand(body.model, body.effort, settingsPath, buildTicketPrompt(body.ticket, deps.prompts().ticket));
    const refused = await spawn(deps, id, cwd, command);
    if (refused) return refused;

    const now = deps.now();
    const session: SessionMeta = {
      id,
      kind: "ticket",
      project: ticket.project,
      ticket: body.ticket,
      cwd,
      model: body.model,
      effort: body.effort,
      state: "starting",
      alert: null,
      createdAt: now,
      lastEventAt: now,
      hidden: false,
    };
    record(deps, session);
    watchStartupStall(id, stallDeps(deps));

    // After the session exists, and never able to fail it: Linear being down costs the
    // ticket its status move, not the launch.
    const failures: string[] = [];
    for (const write of [() => deps.linear.setStatus(body.ticket, "In Progress"), () => deps.linear.assignToMe(body.ticket)]) {
      try {
        await write();
      } catch (err) {
        failures.push(message(err));
      }
    }
    void deps.tickets.refresh().catch(() => {});

    return failures.length === 0
      ? { ok: true, session }
      : { ok: true, session, warning: `Linear status not updated: ${failures.join("; ")}` };
  } finally {
    launching.delete(id);
  }
}

const slug = (project: string | null) => (project === null ? "general" : project.toLowerCase().replace(/[^a-z0-9]/g, "-"));

export async function launchFree(body: LaunchFreeBody, deps: LaunchDeps): Promise<LaunchResult> {
  let cwd = deps.cfg.home;
  if (body.project !== null) {
    const project = deps.projects.get(body.project);
    if (!project) return { ok: false, status: 400, error: `project not mapped: ${body.project}` };
    cwd = expandHome(project.path, deps.cfg.home);
  }
  if (!usableDir(deps, cwd)) return { ok: false, status: 400, error: `project path not found: ${cwd}` };

  const id = `${PREFIX}${slug(body.project)}-${deps.randomHex()}`;
  const now = deps.now();
  const base = {
    id,
    project: body.project,
    ticket: null,
    cwd,
    alert: null,
    createdAt: now,
    lastEventAt: now,
    hidden: false,
  };

  if (body.kind === "shell") {
    // A shell fires no hooks, ever: it starts "running" and stays there, with no stall watch.
    const refused = await spawn(deps, id, cwd, SHELL_COMMAND);
    if (refused) return refused;
    const session: SessionMeta = { ...base, kind: "shell", model: null, effort: null, state: "running" };
    record(deps, session);
    return { ok: true, session };
  }

  if (body.model === undefined || body.effort === undefined) {
    return { ok: false, status: 400, error: "model and effort are required for a claude session" };
  }
  const settingsPath = hookSettingsPath(deps.cfg, id);
  deps.writeFile(settingsPath, JSON.stringify(buildHookSettings(id, selfOrigin(deps.cfg), deps.cfg.token)));
  const refused = await spawn(deps, id, cwd, claudeCommand(body.model, body.effort, settingsPath));
  if (refused) return refused;
  const session: SessionMeta = {
    ...base,
    kind: "claude",
    model: body.model,
    effort: body.effort,
    state: "starting",
  };
  record(deps, session);
  watchStartupStall(id, stallDeps(deps));
  return { ok: true, session };
}
