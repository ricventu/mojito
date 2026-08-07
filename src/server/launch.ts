import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import type { Effort, SessionMeta } from "./types.js";
import { tmuxName, validateTicket, statusSlug, customSessionName, rebaseSessionName, shellSessionName } from "./sessionKey.js";
import { buildHookSettings } from "./hookSettings.js";
import { loadProjectMap, resolvePathForProject } from "./limeProjects.js";
import { resolveTicketCwd } from "./ticketCwd.js";
import { logfilePath } from "./sidecar.js";
import type { Registry } from "./registry.js";
import { writeLaunchContext, writeNewTicketContext } from "./launchContext.js";
import { branchChangedLines, scaleReviewProfile } from "./reviewScale.js";
import { defaultModelForStatus, defaultEffortForStatus } from "./stageDefaults.js";
import { readAutoScale } from "./scaleSettings.js";
import { buildWorkPrompt } from "./prompts.js";
import { resultPath, clearSessionResult } from "./sessionResult.js";

export interface LaunchRequest {
  ticket: string;
  status: string;
  model: string;
  effort: Effort;
  autoAdvance: boolean;
  projectName: string | null;
  title: string;
  labels: string[];
  description: string;
  rejectReason?: string;
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
  changedLines?: (cwd: string) => number | null;
  nowIso?: () => string;
}

function defaultResolveCwd(projectsPath: string) {
  return (ticket: string, projectName: string | null): string | null =>
    resolveTicketCwd(projectsPath, ticket, projectName);
}

export function buildClaudeCommand(
  req: { model: string; effort: Effort },
  settingsPath: string,
  prompt: string,
): string {
  const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  if (prompt.startsWith("-")) throw new Error("prompt must not start with '-'");
  return `claude --model ${q(req.model)} --effort ${q(req.effort)} --settings ${q(settingsPath)} ${q(prompt)}`;
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

  // Review sessions read a diff whose size is knowable before the spawn: when the
  // request is exactly the stage default (auto-advance always is; a manual launch the
  // user didn't retune), downgrade model/effort for small branches. An explicit user
  // choice is never overridden, and an unmeasurable diff keeps the default profile.
  let scaledFrom: SessionMeta["scaledFrom"];
  if (
    readAutoScale() &&
    (req.status === "To Review" || req.status === "To Merge") &&
    req.model === defaultModelForStatus(req.status) &&
    req.effort === defaultEffortForStatus(req.status)
  ) {
    const lines = (deps.changedLines ?? branchChangedLines)(cwd);
    if (lines !== null) {
      // To Merge's inline review gates the merge with no re-QA behind the clean path:
      // scale its effort only, never its model. To Review has human QA behind it.
      const scaled = scaleReviewProfile(req.model, req.effort, lines, {
        effortOnly: req.status === "To Merge",
      });
      if (scaled.scaled) {
        scaledFrom = { model: req.model, effort: req.effort };
        req = { ...req, model: scaled.model, effort: scaled.effort };
      }
    }
  }

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
    description: req.description,
    ...(req.rejectReason ? { rejectReason: req.rejectReason } : {}),
  });
  clearSessionResult(deps.stateDir, id); // ids repeat per ticket+status: a stale result must not satisfy the new session's Stop hook
  const command = buildClaudeCommand(req, settingsPath, buildWorkPrompt({
    ticket: req.ticket,
    contextPath,
    resultPath: resultPath(deps.stateDir, id),
  }));
  await deps.newSession(id, cwd, command);
  await deps.pipePane(id, logfilePath(deps.stateDir, id));

  const meta: SessionMeta = {
    kind: "ticket",
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
    ...(scaledFrom ? { scaledFrom } : {}),
  };
  deps.registry.upsert(meta);
  return { ok: true, meta };
}

export interface CustomLaunchRequest {
  projectName: string | null;
  model: string;
  effort: Effort;
  // Ticket-scoped custom session (RIC-128). When `ticket` is set, cwd resolves through the
  // ticket→worktree chain and a launch-context file is written. Absent = project-scoped (RIC-115).
  ticket?: string;
  status?: string;
  title?: string;
  labels?: string[];
  prompt?: string;
}

export function buildCustomClaudeCommand(req: CustomLaunchRequest, settingsPath: string): string {
  const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  const base = `claude --model ${q(req.model)} --effort ${q(req.effort)} --settings ${q(settingsPath)}`;
  if (req.prompt && req.prompt.startsWith("-")) {
    throw new Error("prompt must not start with '-'");
  }
  return req.prompt ? `${base} ${q(req.prompt)}` : base;
}

export async function launchCustomSession(
  req: CustomLaunchRequest,
  deps: LaunchDeps & { genId?: () => string; homeDir?: () => string },
): Promise<{ ok: true; meta: SessionMeta } | { ok: false; reason: "no-repo" }> {
  const homeDir = deps.homeDir ?? (() => homedir());
  const genId = deps.genId ?? (() => randomBytes(3).toString("hex"));

  // cwd + id + slug differ for a ticket-scoped launch vs a project-scoped one.
  let cwd: string;
  let slug: string;
  if (req.ticket) {
    // Same resolver the lime path uses: worktree if one exists for the ticket, else repo root.
    const resolveCwd = deps.resolveCwd ?? defaultResolveCwd(deps.projectsPath);
    const resolved = resolveCwd(req.ticket, req.projectName);
    if (!resolved) return { ok: false, reason: "no-repo" };
    cwd = resolved;
    slug = statusSlug(req.ticket);
  } else if (req.projectName) {
    const path = resolvePathForProject(loadProjectMap(deps.projectsPath), req.projectName);
    if (!path) return { ok: false, reason: "no-repo" };
    cwd = path;
    slug = statusSlug(req.projectName);
  } else {
    cwd = homeDir();
    slug = "general";
  }

  const id = customSessionName(slug, genId());

  const settingsDir = join(deps.stateDir, "settings");
  mkdirSync(settingsDir, { recursive: true, mode: 0o700 });
  const settingsPath = join(settingsDir, `${id}.json`);
  writeFileSync(settingsPath, JSON.stringify(buildHookSettings(id, deps.port, deps.token), null, 2), { mode: 0o600 });
  chmodSync(settingsPath, 0o600); // mode on writeFileSync is ignored if the file pre-existed

  // A custom session — ticket-scoped or project-scoped — is a bare interactive session
  // with a human driving it; it needs no machine-readable context file.
  const command = buildCustomClaudeCommand(req, settingsPath);
  await deps.newSession(id, cwd, command);
  await deps.pipePane(id, logfilePath(deps.stateDir, id));

  const title = req.ticket ? (req.title ?? basename(cwd)) : cwd === homeDir() ? "home" : basename(cwd);
  const meta: SessionMeta = {
    kind: "custom",
    id,
    ticket: req.ticket ?? "",
    launchStatus: "",
    model: req.model,
    effort: req.effort,
    autoAdvance: false,
    state: "starting",
    cwd,
    createdAt: (deps.nowIso ?? (() => new Date().toISOString()))(),
    projectName: req.projectName,
    title,
    labels: req.ticket ? (req.labels ?? []) : [],
  };
  deps.registry.upsert(meta);
  return { ok: true, meta };
}

export interface NewTicketLaunchRequest {
  brief: string;
  projectName: string | null;
  model: string;
  effort: Effort;
  images?: string[];
}

export function buildNewTicketClaudeCommand(
  req: NewTicketLaunchRequest,
  settingsPath: string,
  contextPath: string,
): string {
  const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  return (
    `LIME_NEW_CONTEXT=${q(contextPath)} ` +
    `claude --model ${q(req.model)} --effort ${q(req.effort)} --settings ${q(settingsPath)} ${q("/lime-new")}`
  );
}

export async function launchNewTicketSession(
  req: NewTicketLaunchRequest,
  deps: LaunchDeps & { genId?: () => string; homeDir?: () => string },
): Promise<{ ok: true; meta: SessionMeta } | { ok: false; reason: "no-repo" }> {
  const homeDir = deps.homeDir ?? (() => homedir());
  const genId = deps.genId ?? (() => randomBytes(3).toString("hex"));

  let cwd: string;
  if (req.projectName) {
    const path = resolvePathForProject(loadProjectMap(deps.projectsPath), req.projectName);
    if (!path) return { ok: false, reason: "no-repo" };
    cwd = path;
  } else {
    cwd = homeDir();
  }

  const slug = req.projectName ? statusSlug(req.projectName) : "new-ticket";
  const id = customSessionName(slug, genId());

  const settingsDir = join(deps.stateDir, "settings");
  mkdirSync(settingsDir, { recursive: true, mode: 0o700 });
  const settingsPath = join(settingsDir, `${id}.json`);
  writeFileSync(settingsPath, JSON.stringify(buildHookSettings(id, deps.port, deps.token), null, 2), { mode: 0o600 });
  chmodSync(settingsPath, 0o600); // mode on writeFileSync is ignored if the file pre-existed

  const contextPath = writeNewTicketContext(deps.stateDir, id, {
    brief: req.brief,
    project: req.projectName,
    images: req.images ?? [],
  });

  const command = buildNewTicketClaudeCommand(req, settingsPath, contextPath);
  await deps.newSession(id, cwd, command);
  await deps.pipePane(id, logfilePath(deps.stateDir, id));

  const meta: SessionMeta = {
    kind: "custom",
    id,
    ticket: "",
    launchStatus: "",
    model: req.model,
    effort: req.effort,
    autoAdvance: false,
    state: "starting",
    cwd,
    createdAt: (deps.nowIso ?? (() => new Date().toISOString()))(),
    projectName: req.projectName,
    title: `New ticket · ${req.projectName ?? "home"}`,
    labels: [],
  };
  deps.registry.upsert(meta);
  return { ok: true, meta };
}

export interface RebaseLaunchRequest {
  ticket: string;
  projectName: string | null;
  title: string;
  labels: string[];
  model: string;
  effort: Effort;
}

export function buildRebaseClaudeCommand(
  req: RebaseLaunchRequest,
  settingsPath: string,
  contextPath: string,
): string {
  const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  return (
    `LIME_SESSION_CONTEXT=${q(contextPath)} ` +
    `claude --model ${q(req.model)} --effort ${q(req.effort)} ` +
    `--settings ${q(settingsPath)} ${q(`/lime-rebase ${req.ticket}`)}`
  );
}

/**
 * Launch a one-off session that rebases the ticket's worktree branch onto the default
 * branch (the To-Merge "first part", no merge). Distinct session name so it never collides
 * with the To-QA gate session; autoAdvance is always off (this is not a lifecycle handoff).
 */
export async function launchRebaseSession(
  req: RebaseLaunchRequest,
  deps: LaunchDeps,
): Promise<{ ok: true; meta: SessionMeta } | { ok: false; reason: "duplicate" | "no-repo"; id?: string }> {
  validateTicket(req.ticket);
  const id = rebaseSessionName(req.ticket);

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
    statusName: "To QA",
    title: req.title,
    project: req.projectName,
    labels: req.labels,
    description: "", // /lime-rebase reads Linear itself; no Mojito-fetched description to pass
  });

  const command = buildRebaseClaudeCommand(req, settingsPath, contextPath);
  await deps.newSession(id, cwd, command);
  await deps.pipePane(id, logfilePath(deps.stateDir, id));

  const meta: SessionMeta = {
    kind: "rebase",
    id,
    ticket: req.ticket,
    launchStatus: "To QA",
    model: req.model,
    effort: req.effort,
    autoAdvance: false,
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

export interface ShellLaunchRequest {
  projectName: string | null;
  // Ticket-scoped shell (RIC-155): when `ticket` is set, cwd resolves through the
  // ticket→worktree chain. Absent = project-scoped, or general (home) when projectName is null.
  ticket?: string;
  status?: string;
  title?: string;
  labels?: string[];
}

export function buildShellCommand(shell?: string): string {
  // A plain login shell — behaves like a normally-opened terminal (sources the user's profile).
  // Use the host's configured login shell ($SHELL), falling back to bash: hardcoding zsh broke
  // Linux deployments where zsh isn't installed (macOS defaults to zsh, Linux typically to bash).
  // No env prefix, no --settings, no slash command: a shell fires no claude hooks.
  const login = (shell ?? "").trim() || "/bin/bash";
  return `${login} -l`;
}

export async function launchShellSession(
  req: ShellLaunchRequest,
  deps: LaunchDeps & { genId?: () => string; homeDir?: () => string; shell?: () => string | undefined },
): Promise<{ ok: true; meta: SessionMeta } | { ok: false; reason: "no-repo" }> {
  const homeDir = deps.homeDir ?? (() => homedir());
  const genId = deps.genId ?? (() => randomBytes(3).toString("hex"));
  const shell = deps.shell ?? (() => process.env.SHELL);

  // Same cwd/slug resolution as launchCustomSession.
  let cwd: string;
  let slug: string;
  if (req.ticket) {
    const resolveCwd = deps.resolveCwd ?? defaultResolveCwd(deps.projectsPath);
    const resolved = resolveCwd(req.ticket, req.projectName);
    if (!resolved) return { ok: false, reason: "no-repo" };
    cwd = resolved;
    slug = statusSlug(req.ticket);
  } else if (req.projectName) {
    const path = resolvePathForProject(loadProjectMap(deps.projectsPath), req.projectName);
    if (!path) return { ok: false, reason: "no-repo" };
    cwd = path;
    slug = statusSlug(req.projectName);
  } else {
    cwd = homeDir();
    slug = "general";
  }

  const id = shellSessionName(slug, genId());

  // A plain shell writes no hook-settings file and no launch-context file.
  const command = buildShellCommand(shell());
  await deps.newSession(id, cwd, command);
  await deps.pipePane(id, logfilePath(deps.stateDir, id));

  const title = req.ticket ? (req.title ?? basename(cwd)) : cwd === homeDir() ? "home" : basename(cwd);
  const meta: SessionMeta = {
    kind: "shell",
    id,
    ticket: req.ticket ?? "",
    launchStatus: "",
    model: "",
    effort: "",
    autoAdvance: false,
    // No hooks will ever move a shell off its initial state, so start it "running" for a
    // sensible badge. registry.recover flips it to "failed" only when its tmux dies.
    state: "running",
    cwd,
    createdAt: (deps.nowIso ?? (() => new Date().toISOString()))(),
    projectName: req.projectName,
    title,
    labels: req.ticket ? (req.labels ?? []) : [],
  };
  deps.registry.upsert(meta);
  return { ok: true, meta };
}

export function buildResolvePrompt(project: string, repo: string, branch: string): string {
  return [
    `You are in the git repository for the "${project}" project at ${repo} (branch ${branch}).`,
    `A fast-forward-only pull (\`git pull --ff-only\`) could NOT fast-forward: this branch and its`,
    `upstream on origin have diverged. Bring the branch up to date with origin without losing local`,
    `work and without force-pushing.`,
    ``,
    `Steps: fetch origin; inspect the divergence (git status, git log --oneline --graph); rebase or`,
    `merge as appropriate and resolve any conflicts; verify the working tree is clean and the branch`,
    `is current. Do not force-push. Do not discard local commits.`,
  ].join("\n");
}

export async function launchStackResolveSession(
  req: { projectName: string; branch: string },
  deps: LaunchDeps & { genId?: () => string; homeDir?: () => string },
): Promise<{ ok: true; meta: SessionMeta } | { ok: false; reason: "no-repo" }> {
  const repo = resolvePathForProject(loadProjectMap(deps.projectsPath), req.projectName);
  if (!repo) return { ok: false, reason: "no-repo" };
  const model = defaultModelForStatus("To Merge");
  const effort = defaultEffortForStatus("To Merge");
  const prompt = buildResolvePrompt(req.projectName, repo, req.branch);
  return launchCustomSession({ projectName: req.projectName, model, effort, prompt }, deps);
}
