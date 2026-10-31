import { LaunchBody } from "@mojito/shared";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { forwardLaunch } from "../../peers/forward";
import type { AppDeps } from "../app";
import { parseBody } from "../body";

/**
 * The other instances (`MOJITO_PEERS`): their snapshots, and a launch on one of them. Nothing
 * else is forwarded — a peer's terminal, git, docs and settings are its own client's.
 */
export function peerRoutes(deps: AppDeps): Hono {
  return new Hono()
    .get("/peers", (c) => c.json(deps.peers?.answer() ?? { self: deps.cfg.name, peers: [] }))
    .post("/peers/:name/sessions", async (c) => {
      const name = c.req.param("name");
      const peer = deps.peers?.config(name);
      if (!peer) return c.json({ error: `peer not found: ${name}` }, 404);
      const body = await parseBody(c, LaunchBody);
      if (!body.ok) return c.json({ error: body.error }, 400);
      if (!deps.peers?.online(name)) return c.json({ error: `${name} is not reachable` }, 502);
      const res = await forwardLaunch(peer, deps.cfg.token, body.data, { fetch: deps.peerFetch });
      return c.json(res.body as object, res.status as ContentfulStatusCode);
    });
}
