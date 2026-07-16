import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface LaunchContext {
  identifier: string;
  statusName: string;
  title: string;
  project: string | null;
  labels: string[];
}

/**
 * Write the per-session launch context the lime-next skill reads to dispatch a
 * stage without calling the Linear `get_issue` MCP. Returns the file path so the
 * caller can pass it to the session via LIME_SESSION_CONTEXT.
 */
export function writeLaunchContext(stateDir: string, id: string, ctx: LaunchContext): string {
  const dir = join(stateDir, "context");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${id}.json`);
  writeFileSync(path, JSON.stringify(ctx, null, 2), { mode: 0o600 });
  chmodSync(path, 0o600); // mode on writeFileSync is ignored if the file pre-existed
  return path;
}

export interface NewTicketContext {
  brief: string;
  project: string | null;
  images: string[];
}

/**
 * Write the per-session context the lime-new skill reads to analyze a free-form brief and
 * associate the selected project. Mirrors writeLaunchContext; returns the file path so the
 * caller can pass it to the session via LIME_NEW_CONTEXT.
 */
export function writeNewTicketContext(stateDir: string, id: string, ctx: NewTicketContext): string {
  const dir = join(stateDir, "context");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${id}.json`);
  writeFileSync(path, JSON.stringify(ctx, null, 2), { mode: 0o600 });
  chmodSync(path, 0o600); // mode on writeFileSync is ignored if the file pre-existed
  return path;
}
