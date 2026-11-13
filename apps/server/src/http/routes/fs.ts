import { isAbsolute, resolve } from "node:path";
import { Hono } from "hono";
import { listDirs } from "../../fs/dirs";
import { expandHome } from "../../homePath";
import type { AppDeps } from "../app";

const LIST_TIMEOUT_MS = 10_000;

/**
 * A folder's subfolders, read-only, for the project folder picker (RIC-585). `path` absent or
 * empty is HOME; `~`/`~/…` is expanded, anything else must be absolute, and `..` segments are
 * normalised away. Not fenced to HOME: the token already opens a shell in every session. Settings
 * edits this instance only, so the route is not on the peer relay's table.
 */
export function fsRoutes(deps: AppDeps): Hono {
  const list = deps.listDirs ?? ((path: string) => listDirs(path, deps.cfg.home));

  return new Hono().get("/fs/dirs", async (c) => {
    const typed = c.req.query("path") || "~";
    if (typed.includes("\0")) return c.json({ error: "invalid path" }, 400);
    const expanded = expandHome(typed, deps.cfg.home);
    if (!isAbsolute(expanded)) return c.json({ error: `path must be absolute: ${typed}` }, 400);
    const path = resolve(expanded);
    // A stale network mount can hang a readdir or a stat for good; the picker must get an answer.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<"late">((done) => {
      timer = setTimeout(() => done("late"), LIST_TIMEOUT_MS);
    });
    const res = await Promise.race([list(path), late]).finally(() => clearTimeout(timer));
    if (res === "late") return c.json({ error: `folder did not answer within ${LIST_TIMEOUT_MS / 1000} s: ${path}` }, 504);
    if (res.ok) return c.json(res.list);
    return res.reason === "not-found"
      ? c.json({ error: `folder not found: ${path}` }, 404)
      : c.json({ error: `folder not readable: ${path}` }, 403);
  });
}
