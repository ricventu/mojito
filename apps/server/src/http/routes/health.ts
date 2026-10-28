import { Hono } from "hono";

/** Unauthenticated liveness probe. */
export function healthRoutes(): Hono {
  return new Hono().get("/health", (c) => c.json({ ok: true }));
}
