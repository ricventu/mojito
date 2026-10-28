import { LaunchTicketBody, StatusBody } from "@mojito/shared";
import { Hono } from "hono";
import type { AppDeps } from "../app";
import { errorMessage, parseBody } from "../body";

const validTicket = (id: string) => LaunchTicketBody.shape.ticket.safeParse(id).success;

/** The board's tickets (from the cache, never a live query) and the writes Linear answers for. */
export function ticketRoutes(deps: AppDeps): Hono {
  return new Hono()
    .get("/tickets", (c) => c.json(deps.tickets.snapshot()))
    .get("/tickets/states", async (c) => {
      const team = c.req.query("team");
      if (!team) return c.json({ error: "team is required" }, 400);
      try {
        return c.json(await deps.linear.listTeamStates(team));
      } catch (err) {
        return c.json({ error: errorMessage(err) }, 502);
      }
    })
    .post("/tickets/:id/status", async (c) => {
      const id = c.req.param("id");
      if (!validTicket(id)) return c.json({ error: `invalid ticket id: ${id}` }, 400);
      const body = await parseBody(c, StatusBody);
      if (!body.ok) return c.json({ error: body.error }, 400);
      try {
        await deps.linear.setStatus(id, body.data.status);
      } catch (err) {
        return c.json({ error: errorMessage(err) }, 502);
      }
      await deps.tickets.refresh();
      return c.json({ ok: true });
    });
}
