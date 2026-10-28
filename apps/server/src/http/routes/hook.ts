import { Hono } from "hono";
import type { AppDeps } from "../app";
import { handleHook } from "../../sessions/hooks";

/**
 * Claude Code hooks, POSTed by the curl in each session's hook settings. Always 200: an unknown
 * session or event is ignored (handleHook never throws), and nothing a hook gets back could
 * change what claude does next anyway. The body (the hook's own JSON) is not read.
 */
export function hookRoutes(deps: AppDeps): Hono {
  return new Hono().post("/hook", (c) => {
    handleHook(c.req.query("session") ?? "", c.req.query("event") ?? "", {
      sessions: deps.sessions,
      bus: deps.bus,
      tickets: deps.tickets,
      now: deps.now ?? Date.now,
    });
    return c.json({ ok: true });
  });
}
