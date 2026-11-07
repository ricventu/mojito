import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { LaunchTicketBody, type Effort, type GitOp, type LaunchFreeBody, type Model, type Prompts, type SessionMeta } from "@mojito/shared";
import { selfOrigin, type ServerConfig } from "../config";
import type { ProjectsRepo } from "../db/projects";
import type { SessionsRepo } from "../db/sessions";
import type { EventBus } from "../events/bus";
import type { SyncConflict } from "../git/sync";
import { expandHome } from "../homePath";
import type { LinearClient } from "../linear/client";
import type { TicketCache } from "../tickets/cache";
import { DuplicateSessionError, PREFIX, hasSession, newSession, q } from "../tmux/tmux";
import { buildHookSettings } from "./hookSettings";
import { imagesDir } from "./images";
import { CLEAN_PROMPT, buildGitResolvePrompt, buildTicketPrompt } from "./prompt";
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

/** The `--settings` file of a session, written at every launch and resume. */
const sessionSettings = (deps: LaunchDeps, id: string): string =>
  JSON.stringify(buildHookSettings(id, selfOrigin(deps.cfg), deps.cfg.token, imagesDir(deps.cfg.stateDir, id)));

function claudeCommand(model: Model, effort: Effort, settingsPath: string, prompt?: string): string {
  const base = `claude --model ${q(model)} --effort ${q(effort)} --settings ${q(settingsPath)}`;
  return prompt === undefined ? base : `${base} ${q(prompt)}`;
}

/**
 * claude picking up a conversation by its id. Run from the project checkout: claude looks for the
 * id there and in the repo's worktrees first, and goes back into the worktree the session had
 * moved to (its transcript went with it), or stays here when that worktree is gone. An adopted
 * row knows no model or effort: claude's defaults then.
 */
function resumeCommand(row: Pick<SessionMeta, "model" | "effort">, settingsPath: string, claudeSessionId: string): string {
  const model = row.model ? ` --model ${q(row.model)}` : "";
  const effort = row.effort ? ` --effort ${q(row.effort)}` : "";
  return `claude${model}${effort} --settings ${q(settingsPath)} --resume ${q(claudeSessionId)}`;
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
      const ended = deps.sessions.patch(live.id, { state: "ended", endReason: "gone" });
      if (ended) deps.bus.emit({ type: "session.updated", session: ended });
    }

    const settingsPath = hookSettingsPath(deps.cfg, id);
    deps.writeFile(settingsPath, sessionSettings(deps, id));
    const command = claudeCommand(body.model, body.effort, settingsPath, buildTicketPrompt(body.ticket, deps.prompts().ticket, body.worktree));
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
      title: null,
      endReason: null,
      claudeSessionId: null,
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
    title: null,
    endReason: null,
    claudeSessionId: null,
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
  deps.writeFile(settingsPath, sessionSettings(deps, id));
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

export type ProjectSessionResult =
  | { ok: true; session: SessionMeta; alreadyOpen: boolean }
  | { ok: false; status: 400 | 409; error: string };

/**
 * The Claude session that finishes a Pull or Push Mojito stopped short of (`git/sync.ts`). One
 * per project — `mj-<slug>-git` — so a second conflict while it is still open answers that
 * session rather than putting two Claudes on one repository. Opus at xhigh effort, inlined like
 * v1's: reconciling diverged history is the hardest reading a session here gets asked to do.
 */
export function launchGitResolve(
  req: { project: string; op: GitOp; conflict: SyncConflict },
  deps: LaunchDeps,
): Promise<ProjectSessionResult> {
  return launchProjectSession(
    { project: req.project, suffix: "git", model: "opus", effort: "xhigh", prompt: buildGitResolvePrompt(req.op, req.conflict) },
    deps,
  );
}

/**
 * A project's Clean (RIC-528): the session that deletes merged branches and their worktrees
 * once the human confirms its list (`CLEAN_PROMPT`). One per project — `mj-<slug>-clean` — like
 * the git session. Sonnet at high effort: the work is routine, the judgment is telling a
 * squash-merged branch from an unmerged one, and nothing is deleted before the human says yes.
 */
export function launchClean(project: string, deps: LaunchDeps): Promise<ProjectSessionResult> {
  return launchProjectSession({ project, suffix: "clean", model: "sonnet", effort: "high", prompt: CLEAN_PROMPT }, deps);
}

/**
 * A session that belongs to a project rather than a ticket, under a fixed id
 * `mj-<slug>-<suffix>`: a live one is answered (`alreadyOpen`) instead of starting a second
 * Claude on the same job; a row whose tmux is gone is ended first.
 */
async function launchProjectSession(
  req: { project: string; suffix: string; model: Model; effort: Effort; prompt: string },
  deps: LaunchDeps,
): Promise<ProjectSessionResult> {
  const project = deps.projects.get(req.project);
  if (!project) return { ok: false, status: 400, error: `project not mapped: ${req.project}` };
  const cwd = expandHome(project.path, deps.cfg.home);
  if (!usableDir(deps, cwd)) return { ok: false, status: 400, error: `project path not found: ${cwd}` };

  const id = `${PREFIX}${slug(req.project)}-${req.suffix}`;
  if (launching.has(id)) return { ok: false, status: 409, error: `session already starting: ${id}` };
  launching.add(id);
  try {
    const existing = deps.sessions.get(id);
    if (existing && existing.state !== "ended") {
      if (await deps.hasSession(id)) return { ok: true, session: existing, alreadyOpen: true };
      const ended = deps.sessions.patch(id, { state: "ended", endReason: "gone" });
      if (ended) deps.bus.emit({ type: "session.updated", session: ended });
    }

    const { model, effort } = req;
    const settingsPath = hookSettingsPath(deps.cfg, id);
    deps.writeFile(settingsPath, sessionSettings(deps, id));
    const refused = await spawn(deps, id, cwd, claudeCommand(model, effort, settingsPath, req.prompt));
    if (refused) return { ok: false, status: 409, error: `session already exists: ${id}` };

    const now = deps.now();
    const session: SessionMeta = {
      id,
      kind: "claude",
      project: req.project,
      ticket: null,
      cwd,
      model,
      effort,
      state: "starting",
      alert: null,
      createdAt: now,
      lastEventAt: now,
      title: null,
      endReason: null,
      claudeSessionId: null,
    };
    record(deps, session);
    watchStartupStall(id, stallDeps(deps));
    return { ok: true, session, alreadyOpen: false };
  } finally {
    launching.delete(id);
  }
}

/**
 * Resume: an ended claude session started again on its own conversation (`claude --resume`),
 * under the same id, so it comes back where it was on the board and in the sidebar. Linear is
 * not touched: the ticket is where the human left it. A shell has no conversation to resume,
 * nor does a session no hook ever reached (no `claudeSessionId`); a live one is a 409 carrying
 * its id, like a second Launch.
 */
export async function resumeSession(id: string, deps: LaunchDeps): Promise<LaunchResult> {
  const row = deps.sessions.get(id);
  if (!row) return { ok: false, status: 404, error: `session not found: ${id}` };
  if (row.kind === "shell") return { ok: false, status: 400, error: "a shell has no conversation to resume" };
  if (!row.claudeSessionId) return { ok: false, status: 409, error: "no claude conversation was recorded for this session" };
  const cwd = expandHome(row.cwd, deps.cfg.home);
  if (!usableDir(deps, cwd)) return { ok: false, status: 400, error: `session directory not found: ${cwd || "(none)"}` };

  if (launching.has(id)) return conflict(id);
  launching.add(id);
  try {
    if (row.state !== "ended") {
      if (await deps.hasSession(id)) return conflict(id);
      const ended = deps.sessions.patch(id, { state: "ended", endReason: "gone" });
      if (ended) deps.bus.emit({ type: "session.updated", session: ended });
    }

    const settingsPath = hookSettingsPath(deps.cfg, id);
    deps.writeFile(settingsPath, sessionSettings(deps, id));
    const refused = await spawn(deps, id, cwd, resumeCommand(row, settingsPath, row.claudeSessionId));
    if (refused) return refused;

    // A new start: `createdAt` too, so it sorts as the newest and no pane poll that read the
    // ended row can take it for the same session.
    const now = deps.now();
    const session: SessionMeta = {
      ...row,
      state: "starting",
      alert: null,
      createdAt: now,
      lastEventAt: now,
      endReason: null,
    };
    record(deps, session);
    watchStartupStall(id, stallDeps(deps));
    return { ok: true, session };
  } finally {
    launching.delete(id);
  }
}
