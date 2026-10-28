import { Hono } from "hono";
import type { AppDeps } from "../app";
import { handleHook } from "../../sessions/hooks";

/**
 * Claude Code hooks, POSTed by the curl in each session's hook settings. Always 200: an unknown
 * session or event is ignored (handleHook never throws), and nothing a hook gets back could
 * change what claude does next anyway. The body is the hook's own JSON (the curl posts claude's
 * hook input from stdin); an empty or malformed one is passed on as `undefined`, never a 400.
 */
export function hookRoutes(deps: AppDeps): Hono {
  return new Hono().post("/hook", async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    handleHook(
      c.req.query("session") ?? "",
      c.req.query("event") ?? "",
      {
        sessions: deps.sessions,
        bus: deps.bus,
        tickets: deps.tickets,
        now: deps.now ?? Date.now,
      },
      body,
    );
    return c.json({ ok: true });
  });
}
