import { statSync } from "node:fs";
import { join, resolve } from "node:path";
import { listMappedProjects, loadProjectMap, type ProjectMap } from "./limeProjects.js";
import { statusSlug, stackSessionName } from "./sessionKey.js";
import { hasSession as tmuxHasSession, panesDead as tmuxPanesDead, startStackSession, killSession as tmuxKillSession } from "./tmux.js";
import type { StackRow, StackStatus } from "@/lib/stacks";

export interface StackDeps {
  projectsPath: string;
  selfPath: string; // the server's own repo root (process.cwd()); its row is not pullable
  loadMap?: (path: string) => ProjectMap;
  isExecutable?: (p: string) => boolean;
  hasSession?: (name: string) => Promise<boolean>;
  panesDead?: (name: string) => Promise<string>;
  startSession?: (name: string, cwd: string, command: string) => Promise<void>;
  killSession?: (name: string) => Promise<void>;
}

export interface StackTarget {
  project: string;
  path: string;
  hasStack: boolean;
  pullable: boolean;
}

function defaultIsExecutable(p: string): boolean {
  try {
    const s = statSync(p);
    return s.isFile() && (s.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function paneStatus(raw: string): StackStatus {
  const panes = raw.split("\n").map((s) => s.trim()).filter(Boolean);
  return panes.some((d) => d === "1") ? "crashed" : "running";
}

export function resolveStack(slug: string, deps: StackDeps): StackTarget | null {
  const loadMap = deps.loadMap ?? loadProjectMap;
  const isExecutable = deps.isExecutable ?? defaultIsExecutable;
  const match = listMappedProjects(loadMap(deps.projectsPath)).find((p) => statusSlug(p.name) === slug);
  if (!match) return null;
  return {
    project: match.name,
    path: match.path,
    hasStack: isExecutable(join(match.path, "scripts", "start.sh")),
    pullable: resolve(match.path) !== resolve(deps.selfPath),
  };
}

async function statusOf(slug: string, deps: StackDeps): Promise<StackStatus> {
  const hasSession = deps.hasSession ?? tmuxHasSession;
  const panesDead = deps.panesDead ?? tmuxPanesDead;
  const name = stackSessionName(slug);
  if (!(await hasSession(name))) return "stopped";
  return paneStatus(await panesDead(name));
}

export async function listStacks(deps: StackDeps): Promise<StackRow[]> {
  const loadMap = deps.loadMap ?? loadProjectMap;
  const isExecutable = deps.isExecutable ?? defaultIsExecutable;
  const projects = listMappedProjects(loadMap(deps.projectsPath));
  return Promise.all(
    projects.map(async ({ name, path }): Promise<StackRow> => {
      const slug = statusSlug(name);
      const hasStack = isExecutable(join(path, "scripts", "start.sh"));
      return {
        project: name,
        slug,
        hasStack,
        status: hasStack ? await statusOf(slug, deps) : null,
        pullable: resolve(path) !== resolve(deps.selfPath),
      };
    }),
  );
}

export type StackActionResult =
  | { ok: true; status: StackStatus }
  | { ok: false; error: string; code: number };

export async function startStack(slug: string, deps: StackDeps): Promise<StackActionResult> {
  const target = resolveStack(slug, deps);
  if (!target || !target.hasStack) return { ok: false, error: "no stack", code: 404 };
  const hasSession = deps.hasSession ?? tmuxHasSession;
  const startSession = deps.startSession ?? startStackSession;
  const name = stackSessionName(slug);
  if (await hasSession(name)) return { ok: false, error: "already running", code: 409 };
  await startSession(name, target.path, "bash -lc 'scripts/start.sh'");
  return { ok: true, status: "running" };
}

export async function stopStack(slug: string, deps: StackDeps): Promise<StackActionResult> {
  const target = resolveStack(slug, deps);
  if (!target || !target.hasStack) return { ok: false, error: "no stack", code: 404 };
  const hasSession = deps.hasSession ?? tmuxHasSession;
  const killSession = deps.killSession ?? tmuxKillSession;
  const name = stackSessionName(slug);
  if (!(await hasSession(name))) return { ok: false, error: "not running", code: 409 };
  await killSession(name);
  return { ok: true, status: "stopped" };
}
