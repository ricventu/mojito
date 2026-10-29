import { describe, expect, it } from "vitest";
import { defaultSettings } from "../../src/db/settings";
import { setup } from "./setup";

describe("/api/settings", () => {
  it("answers the defaults on a fresh database", async () => {
    const { req } = setup();
    const res = await req("/api/settings");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(defaultSettings());
  });

  it("stores what PUT sends and answers it back", async () => {
    const { req, settings } = setup();
    const next = { statusDefaults: { Todo: { model: "sonnet", effort: "low" } } };
    const res = await req("/api/settings", { method: "PUT", json: next });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.statusDefaults.Todo).toEqual({ model: "sonnet", effort: "low" });
    expect(settings.get()).toEqual(body);
  });

  it("refuses an unknown model", async () => {
    const { req, settings } = setup();
    const res = await req("/api/settings", {
      method: "PUT",
      json: { statusDefaults: { Todo: { model: "gpt", effort: "low" } } },
    });
    expect(res.status).toBe(400);
    expect(settings.get()).toEqual(defaultSettings());
  });
});
