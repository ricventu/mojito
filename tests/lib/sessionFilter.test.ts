import { describe, it, expect } from "vitest";
import { sessionStatuses, filterSessions, sessionStatus, CUSTOM_STATUS, TERMINAL_STATUS } from "@/lib/sessionFilter";
import { NO_PROJECT } from "@/lib/ticketFilter";
import type { SessionMeta } from "@/server/types";

// minimal SessionMeta factory — only the fields these functions read matter
function session(p: Partial<SessionMeta>): SessionMeta {
  return {
    kind: "ticket",
    id: "mojito-RIC-1-to-code",
    ticket: "RIC-1",
    launchStatus: "To Code",
    model: "opus",
    effort: "low",
    autoAdvance: false,
    state: "running",
    cwd: "",
    createdAt: "2026-07-16T10:00:00.000Z",
    projectName: "Mojito",
    title: "Title",
    labels: [],
    ...p,
  } as SessionMeta;
}

describe("sessionStatuses", () => {
  it("returns [] for no sessions", () => {
    expect(sessionStatuses([])).toEqual([]);
  });

  it("returns distinct launch statuses ordered by lifecycle rank", () => {
    const sessions = [
      session({ launchStatus: "Done" }),
      session({ launchStatus: "To Code" }),
      session({ launchStatus: "To Review" }),
      session({ launchStatus: "To Code" }),
    ];
    expect(sessionStatuses(sessions)).toEqual(["To Code", "To Review", "Done"]);
  });

  it("surfaces custom sessions as the CUSTOM_STATUS bucket, sorted last", () => {
    const sessions = [
      session({ kind: "custom", launchStatus: "" }),
      session({ launchStatus: "To QA" }),
    ];
    expect(sessionStatuses(sessions)).toEqual(["To QA", CUSTOM_STATUS]);
  });

  it("collapses multiple custom sessions into a single CUSTOM_STATUS entry", () => {
    const sessions = [
      session({ kind: "custom", launchStatus: "" }),
      session({ kind: "custom", launchStatus: "" }),
    ];
    expect(sessionStatuses(sessions)).toEqual([CUSTOM_STATUS]);
  });

  it("surfaces shell sessions as the TERMINAL_STATUS bucket, sorted last", () => {
    const sessions = [
      session({ kind: "shell", launchStatus: "" }),
      session({ launchStatus: "To QA" }),
    ];
    expect(sessionStatuses(sessions)).toEqual(["To QA", TERMINAL_STATUS]);
  });

  it("sorts unknown statuses last with alphabetical tie-break", () => {
    const sessions = [
      session({ launchStatus: "Zeta" }),
      session({ launchStatus: "Alpha" }),
      session({ launchStatus: "To Code" }),
    ];
    expect(sessionStatuses(sessions)).toEqual(["To Code", "Alpha", "Zeta"]);
  });
});

describe("filterSessions", () => {
  const sessions = [
    session({ id: "a", ticket: "RIC-1", launchStatus: "To Code", projectName: "Mojito", title: "Alpha" }),
    session({ id: "b", ticket: "RIC-2", launchStatus: "To QA", projectName: "Lime", title: "Beta" }),
    session({ id: "c", ticket: "RIC-3", launchStatus: "To Code", projectName: null, title: "Gamma" }),
  ];

  it("returns all sessions when no criteria are active", () => {
    const out = filterSessions(sessions, { query: "", project: null, status: null });
    expect(out.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("filters by status", () => {
    const out = filterSessions(sessions, { query: "", project: null, status: "To Code" });
    expect(out.map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("filters custom sessions via the CUSTOM_STATUS bucket", () => {
    const withCustom = [
      ...sessions,
      session({ id: "d", kind: "custom", launchStatus: "", ticket: "", projectName: "Mojito", title: "Custom one" }),
    ];
    const out = filterSessions(withCustom, { query: "", project: null, status: CUSTOM_STATUS });
    expect(out.map((s) => s.id)).toEqual(["d"]);
  });

  it("filters shell sessions via the TERMINAL_STATUS bucket", () => {
    const withShell = [
      ...sessions,
      session({ id: "e", kind: "shell", launchStatus: "", ticket: "", projectName: "Mojito", title: "Terminal one" }),
    ];
    const out = filterSessions(withShell, { query: "", project: null, status: TERMINAL_STATUS });
    expect(out.map((s) => s.id)).toEqual(["e"]);
  });

  it("filters by project, using the NO_PROJECT sentinel for projectless sessions", () => {
    const out = filterSessions(sessions, { query: "", project: NO_PROJECT, status: null });
    expect(out.map((s) => s.id)).toEqual(["c"]);
  });

  it("filters by query across ticket, title, status, model and message", () => {
    expect(filterSessions(sessions, { query: "beta", project: null, status: null }).map((s) => s.id)).toEqual(["b"]);
    expect(filterSessions(sessions, { query: "ric-3", project: null, status: null }).map((s) => s.id)).toEqual(["c"]);
    expect(filterSessions(sessions, { query: "to qa", project: null, status: null }).map((s) => s.id)).toEqual(["b"]);
  });

  it("combines criteria with AND semantics", () => {
    // status matches a & c, project narrows to Mojito → only a
    const out = filterSessions(sessions, { query: "", project: "Mojito", status: "To Code" });
    expect(out.map((s) => s.id)).toEqual(["a"]);
    // no session is both To QA and in Mojito
    expect(filterSessions(sessions, { query: "", project: "Mojito", status: "To QA" })).toEqual([]);
  });

  it("does not throw on sessions missing optional fields", () => {
    const bare = [session({ id: "x", message: undefined })];
    expect(filterSessions(bare, { query: "nope", project: null, status: null })).toEqual([]);
  });
});
