import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Effort, SessionMeta } from "./types.js";
import { tmuxName, parseIdentifier, validateTicket } from "./sessionKey.js";
import { buildHookSettings } from "./hookSettings.js";
import { loadProjectMap, resolveRepoFromMap } from "./limeProjects.js";
import { resolveWorktree } from "./worktree.js";
import { logfilePath } from "./sidecar.js";
import type { Registry } from "./registry.js";
import { writeLaunchContext } from "./launchContext.js";

export interface LaunchRequest {
  ticket: string;
  status: string;
  model: string;
  effort: Effort;
  autoAdvance: boolean;
  projectName: string | null;
  title: string;
  labels: string[];
  trailingArg?: string;
}

export interface LaunchDeps {
  registry: Registry;
  stateDir: string;
  port: number;
  token: string;
  projectsPath: string;
  hasSession: (name: string) => Promise<boolean>;
  newSession: (name: string, cwd: string, command: string) => Promise<void>;
  pipePane: (name: string, logfile: string) => Promise<void>;
  resolveCwd?: (ticket: string, projectName: string | null) => string | null;
  nowIso?: () => string;
}

function defaultResolveCwd(projectsPath: string) {
  return (ticket: string, projectName: string | null): string | null => {
    const { teamKey } = parseIdentifier(ticket);
    const repo = resolveRepoFromMap(loadProjectMap(projectsPath), teamKey, projectName);
    if (!repo) return null;
    return resolveWorktree(repo, ticket) ?? repo;
  };
}

export function buildClaudeCommand(req: LaunchRequest, settingsPath: string, contextPath?: string): string {
  const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  const envPrefix = contextPath ? `LIME_SESSION_CONTEXT=${q(contextPath)} ` : "";
  return (
    `${envPrefix}claude --model ${q(req.model)} --effort ${q(req.effort)} ` +
    `--settings ${q(settingsPath)} ${q(`/lime-next ${req.ticket}${req.trailingArg ? ` ${req.trailingArg}` : ""}`)}`
  );
}

export async function launchSession(
  req: LaunchRequest,
  deps: LaunchDeps,
): Promise<{ ok: true; meta: SessionMeta } | { ok: false; reason: "duplicate" | "no-repo"; id?: string }> {
  validateTicket(req.ticket);
  const id = tmuxName(req.ticket, req.status);

  if (await deps.hasSession(id)) return { ok: false, reason: "duplicate", id };

  const resolveCwd = deps.resolveCwd ?? defaultResolveCwd(deps.projectsPath);
  const cwd = resolveCwd(req.ticket, req.projectName);
  if (!cwd) return { ok: false, reason: "no-repo" };

  const settingsDir = join(deps.stateDir, "settings");
  mkdirSync(settingsDir, { recursive: true, mode: 0o700 });
  const settingsPath = join(settingsDir, `${id}.json`);
  writeFileSync(settingsPath, JSON.stringify(buildHookSettings(id, deps.port, deps.token), null, 2), {
    mode: 0o600,
  });
  chmodSync(settingsPath, 0o600); // mode on writeFileSync is ignored if the file pre-existed

  const contextPath = writeLaunchContext(deps.stateDir, id, {
    identifier: req.ticket,
    statusName: req.status,
    title: req.title,
    project: req.projectName,
    labels: req.labels,
  });

  const command = buildClaudeCommand(req, settingsPath, contextPath);
  await deps.newSession(id, cwd, command);
  await deps.pipePane(id, logfilePath(deps.stateDir, id));

  const meta: SessionMeta = {
    id,
    ticket: req.ticket,
    launchStatus: req.status,
    model: req.model,
    effort: req.effort,
    autoAdvance: req.autoAdvance,
    state: "starting",
    cwd,
    createdAt: (deps.nowIso ?? (() => new Date().toISOString()))(),
    projectName: req.projectName,
    title: req.title,
    labels: req.labels,
  };
  deps.registry.upsert(meta);
  return { ok: true, meta };
}
