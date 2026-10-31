import { describe, expect, it } from "vitest";
import type { MojitoEvent, SessionMeta } from "@mojito/shared";
import { openDb } from "../../src/db/db";
import { SessionsRepo } from "../../src/db/sessions";
import { EventBus } from "../../src/events/bus";
import { refreshTitles, sessionTitle } from "../../src/sessions/titles";

const meta = (over: Partial<SessionMeta> = {}): SessionMeta => ({
  id: "mj-general-c54816",
  kind: "claude",
  project: null,
  ticket: null,
  cwd: "/home/me",
  model: "opus",
  effort: "high",
  state: "idle",
  alert: null,
  createdAt: 1,
  lastEventAt: 1,
  hidden: false,
  title: null,
  ...over,
});

describe("sessionTitle", () => {
  it("reads the name claude puts after its status glyph", () => {
    expect(sessionTitle("✳ pippo-test")).toBe("pippo-test");
    expect(sessionTitle("✳ Layout desktop: sidebar e modal centrato")).toBe("Layout desktop: sidebar e modal centrato");
    expect(sessionTitle("⠂ webapp26 ")).toBe("webapp26");
  });

  it("is no name before claude has one, nor for a shell's title", () => {
    expect(sessionTitle("✳ Claude Code")).toBeNull();
    expect(sessionTitle("ai-tonic")).toBeNull();
    expect(sessionTitle("ricventu@ai-tonic: ~/code")).toBeNull();
    expect(sessionTitle("✳ ")).toBeNull();
    expect(sessionTitle("")).toBeNull();
  });

  it("keeps a long name to 120 characters", () => {
    expect(sessionTitle(`✳ ${"x".repeat(200)}`)).toBe("x".repeat(120));
  });
});

describe("refreshTitles", () => {
  function setup(rows: SessionMeta[], titles: Record<string, string>) {
    const sessions = new SessionsRepo(openDb(":memory:"));
    for (const r of rows) sessions.insert(r);
    const bus = new EventBus();
    const events: MojitoEvent[] = [];
    bus.subscribe((e) => events.push(e));
    const deps = { sessions, bus, paneTitles: async () => new Map(Object.entries(titles)) };
    return { sessions, events, refresh: () => refreshTitles(deps) };
  }

  it("names a session from its pane title and tells the clients", async () => {
    const { sessions, events, refresh } = setup([meta()], { "mj-general-c54816": "✳ pippo-test" });
    await refresh();
    expect(sessions.get("mj-general-c54816")?.title).toBe("pippo-test");
    expect(events).toEqual([{ type: "session.updated", session: sessions.get("mj-general-c54816") }]);
  });

  it("emits nothing when the name has not changed", async () => {
    const { events, refresh } = setup([meta({ title: "pippo-test" })], { "mj-general-c54816": "✳ pippo-test" });
    await refresh();
    expect(events).toEqual([]);
  });

  it("keeps the last name when the pane has none or is gone", async () => {
    const { sessions, events, refresh } = setup(
      [meta({ title: "kept" }), meta({ id: "mj-general-aaaaaa", title: "also kept" })],
      { "mj-general-c54816": "✳ Claude Code" },
    );
    await refresh();
    expect(sessions.get("mj-general-c54816")?.title).toBe("kept");
    expect(sessions.get("mj-general-aaaaaa")?.title).toBe("also kept");
    expect(events).toEqual([]);
  });

  it("leaves an ended session alone", async () => {
    const { sessions, refresh } = setup([meta({ state: "ended" })], { "mj-general-c54816": "✳ late" });
    await refresh();
    expect(sessions.get("mj-general-c54816")?.title).toBeNull();
  });
});
