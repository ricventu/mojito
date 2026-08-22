import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import type { Effort, SessionMeta } from "./types";
import { tmuxName, validateTicket, statusSlug, customSessionName, conflictSessionName, shellSessionName } from "./sessionKey";
import { buildHookSettings } from "./hookSettings";
import { loadProjectMap, resolvePathForProject } from "./projects";
import { repoForTicket } from "./ticketCwd";
import { findExistingTicketWorktree, createTicketWorktree, resolveWorktreePick } from "./worktree";
import { logfilePath } from "./sidecar";
import type { Registry } from "./registry";
import { writeLaunchContext } from "./launchContext";
import { buildWorkPrompt, buildMergeFixPrompt, buildIntakePrompt } from "./prompts";
import type { MergeMode } from "./merge";
import { resultPath, clearSessionResult } from "./sessionResult";
import type { TicketAsset, TicketAttachment } from "./ticketAssets";
import { watchStartupStall, type StallDeps } from "./startupStall";

export interface LaunchRequest {
  ticket: string;
  status: string;
  model: string;
  effort: Effort;
  projectName: string | null;
  title: string;
  labels: string[];
  description: string;
  assets?: TicketAsset[];
  attachments?: TicketAttachment[];
  // Answer to the "create a worktree for this ticket?" prompt the launch sheet asks
  // whenever the ticket has none yet — absent/false means resolve-or-repo-root, same as
  // before this existed. baseBranch is required for createWorktree to take effect.
  createWorktree?: boolean;
  baseBranch?: string;
  // A worktree the human picked from the ones the repo already has (RIC-243). Wins over
  // every other cwd rule below, because it is the only one that is an explicit choice.
  // Validated server-side — an unlisted path falls back to the repo root with a warning.
  worktree?: string;
}

export interface ResolvedCwd {
  cwd: string;
  // Set when the worktree got created without its setup script (missing or failing), or
  // creation itself failed and the launch fell back to the repo root — never blocks the
  // launch, but the human should see it, so it rides into the session's own terminal.
  warning?: string;
}

// `bus`, `stallGraceMs` and `scheduleStall` are the startup-stall watch's own deps
// (startupStall.ts): every launcher below that registers a session at "starting" arms it,
// so a launch no hook ever speaks for stops claiming to be booting. Optional because the
// watch is inert without a bus — a caller with no client to notify simply has no watch.
export interface LaunchDeps extends Pick<StallDeps, "bus" | "stallGraceMs" | "scheduleStall"> {
  registry: Registry;
  stateDir: string;
  port: number;
  token: string;
  projectsPath: string;
  hasSession: (name: string) => Promise<boolean>;
  newSession: (name: string, cwd: string, command: string) => Promise<void>;
  pipePane: (name: string, logfile: string) => Promise<void>;
  resolveCwd?: (req: {
    ticket: string; projectName: string | null; title: string;
    createWorktree: boolean; baseBranch?: string; worktree?: string;
  }) => ResolvedCwd | null | Promise<ResolvedCwd | null>;
  // The project-scoped counterpart, for a custom session or terminal with no ticket: the
  // project's repo root, or a worktree of it the human picked (RIC-243).
  resolveProjectCwd?: (req: { projectName: string; worktree?: string }) => ResolvedCwd | null;
  nowIso?: () => string;
}

// A picked worktree, or the repo root. The pick is client-supplied and names the directory
// a session is spawned in, so resolveWorktreePick has the last word: a path the repo has no
// worktree at (invented, or removed since the sheet listed it) never becomes a cwd — the
// launch falls back to the repo root and says so, rather than failing.
function pickOrRepo(repo: string, worktree?: string): ResolvedCwd {
  if (!worktree) return { cwd: repo };
  const picked = resolveWorktreePick(repo, worktree);
  if (picked) return { cwd: picked };
  return { cwd: repo, warning: `worktree ${worktree} is not one of this repo's — opening the repo root instead` };
}

// The worktree the human picked, if any (it wins outright: it is the only explicit
// choice here); else the ticket's worktree if one exists already; otherwise the repo root,
// or — only when asked (createWorktree + baseBranch both given) — a freshly created
// worktree. Creation
// is best-effort: a failure at either git or the repo's own setup script surfaces as a
// warning rather than blocking the launch. Async because creation can run the repo's own
// (potentially slow) setup script — see createTicketWorktree's own comment for why that
// must never block the event loop.
export function defaultResolveCwd(projectsPath: string) {
  return async (req: { ticket: string; projectName: string | null; title: string; createWorktree: boolean; baseBranch?: string; worktree?: string }): Promise<ResolvedCwd | null> => {
    const repo = repoForTicket(projectsPath, req.ticket, req.projectName);
    if (!repo) return null;
    if (req.worktree) return pickOrRepo(repo, req.worktree);
    const existing = findExistingTicketWorktree(repo, req.ticket, req.title);
    if (existing) return { cwd: existing };
    if (!req.createWorktree || !req.baseBranch) return { cwd: repo };
    return createTicketWorktree(repo, req.ticket, req.title, req.baseBranch);
  };
}

// The project-scoped counterpart of defaultResolveCwd, for a session with no ticket: the
// project's folder, or a worktree of it the human picked from the New session sheet.
export function defaultResolveProjectCwd(projectsPath: string) {
  return (req: { projectName: string; worktree?: string }): ResolvedCwd | null => {
    const repo = resolvePathForProject(loadProjectMap(projectsPath), req.projectName);
    if (!repo) return null;
    return pickOrRepo(repo, req.worktree);
  };
}

// Where a custom session or a plain terminal opens, and the slug its id is built from.
// The three scopes a launch without a work-phase ticket can have — ticket, project,
// General — resolved once instead of once per launcher: launchCustomSession and
// launchShellSession had this block character-for-character identical, so a rule added to
// one (the worktree pick, RIC-243) would have had to be added to the other by hand.
// null = the scope maps to no repo, which both callers answer as "no-repo".
async function resolveScopedCwd(
  req: { projectName: string | null; ticket?: string; title?: string; createWorktree?: boolean; baseBranch?: string; worktree?: string },
  deps: LaunchDeps & { homeDir?: () => string },
): Promise<{ cwd: string; slug: string; warning?: string } | null> {
  if (req.ticket) {
    // Same resolver the ticket session uses: the picked worktree, else the ticket's own if
    // one exists, else the repo root.
    const resolveCwd = deps.resolveCwd ?? defaultResolveCwd(deps.projectsPath);
    const resolved = await resolveCwd({ ticket: req.ticket, projectName: req.projectName, title: req.title ?? "",
      createWorktree: Boolean(req.createWorktree), baseBranch: req.baseBranch, worktree: req.worktree });
    if (!resolved) return null;
    return { cwd: resolved.cwd, warning: resolved.warning, slug: statusSlug(req.ticket) };
  }
  if (req.projectName) {
    const resolveProjectCwd = deps.resolveProjectCwd ?? defaultResolveProjectCwd(deps.projectsPath);
    const resolved = resolveProjectCwd({ projectName: req.projectName, worktree: req.worktree });
    if (!resolved) return null;
    return { cwd: resolved.cwd, warning: resolved.warning, slug: statusSlug(req.projectName) };
  }
  // General: the home directory is not a repo, so there is no worktree to pick from and
  // `worktree` is deliberately not consulted.
  return { cwd: (deps.homeDir ?? (() => homedir()))(), slug: "general" };
}

// Prepends a warning as an echoed line so it lands where the human is about to look —
// the session's own terminal — without needing any new UI. No-op when there is none.
function withWarning(command: string, warning?: string): string {
  if (!warning) return command;
  const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  return `echo ${q(`⚠️  ${warning}`)}; ${command}`;
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
  const resolved = await resolveCwd({ ticket: req.ticket, projectName: req.projectName, title: req.title,
    createWorktree: Boolean(req.createWorktree), baseBranch: req.baseBranch, worktree: req.worktree });
  if (!resolved) return { ok: false, reason: "no-repo" };
  const { cwd, warning } = resolved;

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
    ...(req.assets?.length ? { assets: req.assets } : {}),
    ...(req.attachments?.length ? { attachments: req.attachments } : {}),
  });
  clearSessionResult(deps.stateDir, id); // ids repeat per ticket+status: a stale result must not satisfy the new session's Stop hook
  const command = buildClaudeCommand(req, settingsPath, buildWorkPrompt({
    ticket: req.ticket,
    contextPath,
    resultPath: resultPath(deps.stateDir, id),
    // Same condition that decides whether the keys land in the context file, so prompt and
    // context can never disagree about what the session will find.
    hasAssets: Boolean(req.assets?.length || req.attachments?.length),
  }));
  await deps.newSession(id, cwd, withWarning(command, warning));
  await deps.pipePane(id, logfilePath(deps.stateDir, id));

  const meta: SessionMeta = {
    kind: "ticket",
    id,
    ticket: req.ticket,
    launchStatus: req.status,
    model: req.model,
    effort: req.effort,
    state: "starting",
    cwd,
    createdAt: (deps.nowIso ?? (() => new Date().toISOString()))(),
    projectName: req.projectName,
    title: req.title,
    labels: req.labels,
  };
  deps.registry.upsert(meta);
  watchStartupStall(meta.id, deps); // no hook ever speaks for a claude blocked before boot (RIC-222)
  return { ok: true, meta };
}

export interface CustomLaunchRequest {
  projectName: string | null;
  model: string;
  effort: Effort;
  // Ticket-scoped custom session (RIC-128). When `ticket` is set, cwd resolves through the
  // ticket→worktree chain (no launch-context file — a bare interactive session has a human
  // driving it and needs no machine contract). Absent = project-scoped (RIC-115).
  ticket?: string;
  status?: string;
  title?: string;
  labels?: string[];
  prompt?: string;
  createWorktree?: boolean;
  baseBranch?: string;
  // A worktree the human picked (RIC-243) — of the ticket's repo for a ticket-scoped
  // session, of the project's repo for a project-scoped one. Ignored for General, which
  // opens in the home directory and has no repo to pick from.
  worktree?: string;
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
  const scoped = await resolveScopedCwd(req, deps);
  if (!scoped) return { ok: false, reason: "no-repo" };
  const { cwd, slug, warning } = scoped;

  const id = customSessionName(slug, genId());

  const settingsDir = join(deps.stateDir, "settings");
  mkdirSync(settingsDir, { recursive: true, mode: 0o700 });
  const settingsPath = join(settingsDir, `${id}.json`);
  writeFileSync(settingsPath, JSON.stringify(buildHookSettings(id, deps.port, deps.token), null, 2), { mode: 0o600 });
  chmodSync(settingsPath, 0o600); // mode on writeFileSync is ignored if the file pre-existed

  // A custom session — ticket-scoped or project-scoped — is a bare interactive session
  // with a human driving it; it needs no machine-readable context file.
  const command = buildCustomClaudeCommand(req, settingsPath);
  await deps.newSession(id, cwd, withWarning(command, warning));
  await deps.pipePane(id, logfilePath(deps.stateDir, id));

  const title = req.ticket ? (req.title ?? basename(cwd)) : cwd === homeDir() ? "home" : basename(cwd);
  const meta: SessionMeta = {
    kind: "custom",
    id,
    ticket: req.ticket ?? "",
    launchStatus: "",
    model: req.model,
    effort: req.effort,
    state: "starting",
    cwd,
    createdAt: (deps.nowIso ?? (() => new Date().toISOString()))(),
    projectName: req.projectName,
    title,
    labels: req.ticket ? (req.labels ?? []) : [],
  };
  deps.registry.upsert(meta);
  watchStartupStall(meta.id, deps); // no hook ever speaks for a claude blocked before boot (RIC-222)
  return { ok: true, meta };
}

export interface MergeFixLaunchRequest {
  ticket: string;
  projectName: string | null;
  title: string;
  description: string;
  model: string;
  effort: Effort;
  // The merge mode the human approved (the session completes the merge that way) and
  // the failed attempt's diagnostic, embedded in the prompt.
  mergeMode: MergeMode;
  blocker: string;
}

/**
 * Launch the merge-fix session for a QA-approved branch whose server-side merge could
 * not complete (rebase conflict, diverged default branch, dirty worktree, ...; see
 * mergeTicketBranch). The merge is already approved, so the session finishes it in the
 * approved mode and reports "merged" through the standard result file — the hook then
 * moves the ticket to Done. The launch context carries statusName "To QA" and the
 * ticket's own `-conflict` session id.
 */
export async function launchMergeFixSession(
  req: MergeFixLaunchRequest,
  deps: LaunchDeps,
): Promise<{ ok: true; meta: SessionMeta } | { ok: false; reason: "duplicate" | "no-repo"; id?: string }> {
  validateTicket(req.ticket);
  const id = conflictSessionName(req.ticket);

  if (await deps.hasSession(id)) return { ok: false, reason: "duplicate", id };

  // Never creates: the branch this session finishes merging is already approved and
  // already has a worktree if it ever needed one. createWorktree stays false unconditionally.
  const resolveCwd = deps.resolveCwd ?? defaultResolveCwd(deps.projectsPath);
  const resolved = await resolveCwd({ ticket: req.ticket, projectName: req.projectName, title: req.title, createWorktree: false });
  if (!resolved) return { ok: false, reason: "no-repo" };
  const { cwd } = resolved;

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
    labels: [],
    description: req.description,
  });
  clearSessionResult(deps.stateDir, id); // the id repeats per ticket: a stale result must not satisfy this session's Stop hook
  const command = buildClaudeCommand(req, settingsPath, buildMergeFixPrompt({
    ticket: req.ticket,
    contextPath,
    resultPath: resultPath(deps.stateDir, id),
    mergeMode: req.mergeMode,
    blocker: req.blocker,
  }));
  await deps.newSession(id, cwd, command);
  await deps.pipePane(id, logfilePath(deps.stateDir, id));

  const meta: SessionMeta = {
    kind: "ticket",
    id,
    ticket: req.ticket,
    launchStatus: "To QA",
    model: req.model,
    effort: req.effort,
    state: "starting",
    cwd,
    createdAt: (deps.nowIso ?? (() => new Date().toISOString()))(),
    projectName: req.projectName,
    title: req.title,
    labels: [],
  };
  deps.registry.upsert(meta);
  watchStartupStall(meta.id, deps); // no hook ever speaks for a claude blocked before boot (RIC-222)
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
  createWorktree?: boolean;
  baseBranch?: string;
  // Same as CustomLaunchRequest.worktree.
  worktree?: string;
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

  // Same cwd/slug resolution as launchCustomSession — literally: one helper for both.
  const scoped = await resolveScopedCwd(req, deps);
  if (!scoped) return { ok: false, reason: "no-repo" };
  const { cwd, slug, warning } = scoped;

  const id = shellSessionName(slug, genId());

  // A plain shell writes no hook-settings file and no launch-context file.
  const command = buildShellCommand(shell());
  await deps.newSession(id, cwd, withWarning(command, warning));
  await deps.pipePane(id, logfilePath(deps.stateDir, id));

  const title = req.ticket ? (req.title ?? basename(cwd)) : cwd === homeDir() ? "home" : basename(cwd);
  const meta: SessionMeta = {
    kind: "shell",
    id,
    ticket: req.ticket ?? "",
    launchStatus: "",
    model: "",
    effort: "",
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
    `Steps: fetch origin; inspect the divergence (git status, git log --oneline --graph); reconcile`,
    `as appropriate (fast-forward, merge, or replaying local commits onto origin) and resolve any`,
    `conflicts; verify the working tree is clean and the branch is current. Do not force-push. Do`,
    `not discard local commits.`,
  ].join("\n");
}

export async function launchStackResolveSession(
  req: { projectName: string; branch: string },
  deps: LaunchDeps & { genId?: () => string; homeDir?: () => string },
): Promise<{ ok: true; meta: SessionMeta } | { ok: false; reason: "no-repo" }> {
  const repo = resolvePathForProject(loadProjectMap(deps.projectsPath), req.projectName);
  if (!repo) return { ok: false, reason: "no-repo" };
  // Analytical-resolve profile (formerly the To Merge stage default, now gone from
  // BUILTIN_STAGE_DEFAULTS): reconciling a diverged branch needs the top model at top
  // effort, so this is inlined rather than resolved through a status that no longer exists.
  const model = "opus";
  const effort: Effort = "xhigh";
  const prompt = buildResolvePrompt(req.projectName, repo, req.branch);
  return launchCustomSession({ projectName: req.projectName, model, effort, prompt }, deps);
}

export interface IntakeLaunchRequest {
  projectName: string | null;
  teamKey: string;
  // Written by the route before the launch (writeTicketDraft): it holds the human's raw
  // note and the image urls Mojito already uploaded, neither of which belongs on a
  // command line. The prompt names this path; the session reads it.
  draftPath: string;
  // Whether that draft carries images. The prompt's images paragraph hangs off it, so a
  // note with no attachments is never told to embed any (RIC-223).
  hasImages: boolean;
}

/**
 * Launch the session that turns a New-ticket draft into a Linear issue. A custom session
 * — no ticket, no launch context, no result file — because at this point there is no
 * ticket: the session creates it through the Linear MCP and that is the end of its job.
 * Sonnet at medium effort is inlined rather than resolved through BUILTIN_STAGE_DEFAULTS:
 * this is a rewrite of one paragraph, not work on a ticket, and no status names it.
 */
export async function launchIntakeSession(
  req: IntakeLaunchRequest,
  deps: LaunchDeps & { genId?: () => string; homeDir?: () => string },
): Promise<{ ok: true; meta: SessionMeta } | { ok: false; reason: "no-repo" }> {
  const prompt = buildIntakePrompt({
    draftPath: req.draftPath, teamKey: req.teamKey, projectName: req.projectName,
    hasImages: req.hasImages,
  });
  return launchCustomSession(
    { projectName: req.projectName, model: "sonnet", effort: "medium", prompt },
    deps,
  );
}
