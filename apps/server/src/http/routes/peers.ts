import { LaunchBody } from "@mojito/shared";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { forwardLaunch } from "../../peers/forward";
import { matchRelay, relayRequest } from "../../peers/relay";
import type { AppDeps } from "../app";
import { parseBody } from "../body";

/**
 * The other instances (`MOJITO_PEERS`): their snapshots, a launch on one of them, and the
 * allowlisted calls of an open session (`peers/relay.ts`: images, git graph, docs). Nothing
 * else is forwarded — a peer's settings, hooks and projects are its own client's.
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
    })
    // After the launch forward above, which keeps winning for `POST …/sessions`.
    .all("/peers/:name/*", (c) => {
      const name = c.req.param("name");
      const peer = deps.peers?.config(name);
      if (!peer) return c.json({ error: `peer not found: ${name}` }, 404);
      // The raw path: `c.req.path` is decoded, which would turn `%2F` into a separator.
      const url = new URL(c.req.url);
      const segments = url.pathname.split("/").slice(4);
      const peerPath = matchRelay(c.req.method, segments);
      if (!peerPath) return c.json({ error: "not found" }, 404);
      if (!deps.peers?.online(name)) return c.json({ error: `${name} is not reachable` }, 502);
      const hasBody = c.req.method !== "GET" && c.req.method !== "HEAD";
      return relayRequest(
        peer,
        deps.cfg.token,
        {
          method: c.req.method,
          peerPath,
          search: url.search,
          contentType: c.req.header("content-type") ?? null,
          body: hasBody ? c.req.raw.body : null,
        },
        { fetch: deps.peerFetch },
      );
    });
}
