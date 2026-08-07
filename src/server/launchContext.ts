import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface LaunchContext {
  identifier: string;
  statusName: string;
  title: string;
  project: string | null;
  labels: string[];
  description: string;
  rejectReason?: string;
}

/**
 * Write the per-session launch context the spawned session itself reads (the file's
 * path is embedded directly in the Mojito-built work prompt — no env var involved) so
 * it can skip a Linear `get_issue`/description fetch and, on QA rework, see why the
 * ticket bounced back. Returns the file path so the caller can embed it in the prompt.
 */
export function writeLaunchContext(stateDir: string, id: string, ctx: LaunchContext): string {
  const dir = join(stateDir, "context");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${id}.json`);
  writeFileSync(path, JSON.stringify(ctx, null, 2), { mode: 0o600 });
  chmodSync(path, 0o600); // mode on writeFileSync is ignored if the file pre-existed
  return path;
}
