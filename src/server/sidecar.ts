import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { SessionMeta } from "./types.js";

function sessionsDir(stateDir: string): string {
  const dir = join(stateDir, "sessions");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function logfilePath(stateDir: string, id: string): string {
  const dir = join(stateDir, "logs");
  mkdirSync(dir, { recursive: true });
  return join(dir, `${id}.log`);
}

export function writeSidecar(stateDir: string, meta: SessionMeta): void {
  writeFileSync(join(sessionsDir(stateDir), `${meta.id}.json`), JSON.stringify(meta, null, 2));
}

export function readSidecar(stateDir: string, id: string): SessionMeta | null {
  try {
    const meta = JSON.parse(readFileSync(join(sessionsDir(stateDir), `${id}.json`), "utf8"));
    // Sidecars written before `kind` existed default to the original lime behavior.
    return { kind: "lime", ...meta } as SessionMeta;
  } catch {
    return null;
  }
}

export function listSidecars(stateDir: string): SessionMeta[] {
  return readdirSync(sessionsDir(stateDir))
    .filter((f) => f.endsWith(".json"))
    .map((f) => readSidecar(stateDir, f.replace(/\.json$/, "")))
    .filter((m): m is SessionMeta => m !== null);
}

export function removeSidecar(stateDir: string, id: string): void {
  try {
    rmSync(join(sessionsDir(stateDir), `${id}.json`));
  } catch {
    /* already gone */
  }
}
