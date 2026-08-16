import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TicketAsset, TicketAttachment } from "./ticketAssets.js";

export interface LaunchContext {
  identifier: string;
  statusName: string;
  title: string;
  project: string | null;
  labels: string[];
  description: string;
  // Linear uploads Mojito already downloaded for the session — it holds no Linear
  // credential of its own, so a bare URL would be unreadable to it. Omitted when empty.
  assets?: TicketAsset[];
  attachments?: TicketAttachment[];
}

/**
 * Write the per-session launch context the spawned session itself reads (the file's
 * path is embedded directly in the Mojito-built work prompt — no env var involved) so
 * it can skip a Linear `get_issue`/description fetch. Returns the file path so the
 * caller can embed it in the prompt.
 */
export function writeLaunchContext(stateDir: string, id: string, ctx: LaunchContext): string {
  const dir = join(stateDir, "context");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${id}.json`);
  writeFileSync(path, JSON.stringify(ctx, null, 2), { mode: 0o600 });
  chmodSync(path, 0o600); // mode on writeFileSync is ignored if the file pre-existed
  return path;
}

/**
 * The context an earlier launchSession call wrote for this session id, if the file is
 * still there. Used to reconstruct a ticket session's metadata when adopting an orphan
 * (see adoptOrphans.ts) — null on anything missing or unreadable, never throws.
 */
export function readLaunchContext(stateDir: string, id: string): LaunchContext | null {
  try {
    return JSON.parse(readFileSync(join(stateDir, "context", `${id}.json`), "utf8"));
  } catch {
    return null;
  }
}
