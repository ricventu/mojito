import { SettingsBody } from "@mojito/shared";
import { Hono } from "hono";
import type { AppDeps } from "../app";
import { parseBody } from "../body";

export function settingsRoutes(deps: AppDeps): Hono {
  return new Hono()
    .get("/settings", (c) => c.json(deps.settings.get()))
    .put("/settings", async (c) => {
      const body = await parseBody(c, SettingsBody);
      if (!body.ok) return c.json({ error: body.error }, 400);
      deps.settings.set(body.data);
      deps.bus.emit({ type: "settings.updated" });
      return c.json(deps.settings.get());
    });
}
