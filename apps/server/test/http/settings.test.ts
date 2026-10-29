import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PROMPTS } from "@mojito/shared";
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

  it("answers the default prompts until they are edited", async () => {
    const { req } = setup();
    const body = (await (await req("/api/settings")).json()) as Record<string, any>;
    expect(body.prompts).toEqual(DEFAULT_PROMPTS);
  });

  it("stores edited prompts and leaves the status defaults alone", async () => {
    const { req, settings } = setup();
    await req("/api/settings", { method: "PUT", json: { statusDefaults: { Todo: { model: "sonnet", effort: "low" } } } });
    const prompts = { ticket: "Do {ticket}.", createTicket: "Be brief." };
    const res = await req("/api/settings", { method: "PUT", json: { prompts } });
    expect(res.status).toBe(200);
    expect(settings.get().prompts).toEqual(prompts);
    expect(settings.get().statusDefaults.Todo).toEqual({ model: "sonnet", effort: "low" });
  });

  it("leaves the prompts alone when only the status defaults are sent", async () => {
    const { req, settings } = setup();
    const prompts = { ticket: "Do {ticket}.", createTicket: "Be brief." };
    await req("/api/settings", { method: "PUT", json: { prompts } });
    await req("/api/settings", { method: "PUT", json: { statusDefaults: { Todo: { model: "sonnet", effort: "low" } } } });
    expect(settings.get().prompts).toEqual(prompts);
  });

  it("stores no copy of a default, so a prompt never edited follows the shipped one", async () => {
    const { req, db } = setup();
    await req("/api/settings", { method: "PUT", json: { prompts: { ...DEFAULT_PROMPTS, createTicket: "Be brief." } } });
    const row = db.prepare("SELECT value FROM settings WHERE key = 'prompts'").get() as { value: string };
    expect(JSON.parse(row.value)).toEqual({ createTicket: "Be brief." });
  });

  it("refuses a ticket prompt without {ticket}", async () => {
    const { req, settings } = setup();
    const res = await req("/api/settings", { method: "PUT", json: { prompts: { ...DEFAULT_PROMPTS, ticket: "Do the ticket." } } });
    expect(res.status).toBe(400);
    expect(settings.get().prompts).toEqual(DEFAULT_PROMPTS);
  });

  it("refuses a blank create-ticket prompt", async () => {
    const { req } = setup();
    const res = await req("/api/settings", { method: "PUT", json: { prompts: { ...DEFAULT_PROMPTS, createTicket: "  \n" } } });
    expect(res.status).toBe(400);
  });

  it("answers no favourites on a fresh database", async () => {
    const { req } = setup();
    const body = (await (await req("/api/settings")).json()) as Record<string, any>;
    expect(body.favorites).toEqual([]);
  });

  it("stores favourites and leaves the other keys alone", async () => {
    const { req, settings } = setup();
    await req("/api/settings", { method: "PUT", json: { statusDefaults: { Todo: { model: "sonnet", effort: "low" } } } });
    const before = settings.get();
    const favorites = [{ name: "Mojito", search: "project=mojito" }];
    const res = await req("/api/settings", { method: "PUT", json: { favorites } });
    expect(res.status).toBe(200);
    expect(settings.get().favorites).toEqual(favorites);
    expect(settings.get().statusDefaults.Todo).toEqual({ model: "sonnet", effort: "low" });
    expect(settings.get().prompts).toEqual(before.prompts);
  });

  it("trims favourite names", async () => {
    const { req, settings } = setup();
    await req("/api/settings", { method: "PUT", json: { favorites: [{ name: "  Mine ", search: "" }] } });
    expect(settings.get().favorites).toEqual([{ name: "Mine", search: "" }]);
  });

  it("refuses duplicate names, ignoring case", async () => {
    const { req, settings } = setup();
    const res = await req("/api/settings", {
      method: "PUT",
      json: { favorites: [{ name: "A", search: "" }, { name: "a", search: "q=x" }] },
    });
    expect(res.status).toBe(400);
    expect(settings.get().favorites).toEqual([]);
  });

  it.each([
    ["an empty name", [{ name: "", search: "" }]],
    ["a 61-character name", [{ name: "x".repeat(61), search: "" }]],
    ["a 2001-character search", [{ name: "A", search: "x".repeat(2001) }]],
    ["51 favourites", Array.from({ length: 51 }, (_, i) => ({ name: `f${i}`, search: "" }))],
  ])("refuses %s", async (_label, favorites) => {
    const { req, settings } = setup();
    const res = await req("/api/settings", { method: "PUT", json: { favorites } });
    expect(res.status).toBe(400);
    expect(settings.get().favorites).toEqual([]);
  });

  it("reads a corrupt favourites row as none, warning once with the reason", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { settings, db } = setup();
      db.prepare("INSERT INTO settings (key, value) VALUES ('favorites', ?)").run(JSON.stringify([{ name: 1 }]));
      expect(settings.get().favorites).toEqual([]);
      expect(settings.get().favorites).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toMatch(/favorites/);
      expect(String(warn.mock.calls[0][0])).toMatch(/name/);
    } finally {
      warn.mockRestore();
    }
  });

  it("emits settings.updated on a successful PUT only", async () => {
    const { req, events } = setup();
    const res = await req("/api/settings", { method: "PUT", json: { favorites: [{ name: "A", search: "" }] } });
    expect(res.status).toBe(200);
    expect(events).toContainEqual({ type: "settings.updated" });
    const count = events.length;
    const bad = await req("/api/settings", { method: "PUT", json: { favorites: [{ name: "", search: "" }] } });
    expect(bad.status).toBe(400);
    expect(events).toHaveLength(count);
  });
});
