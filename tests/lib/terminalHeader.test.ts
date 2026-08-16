import { describe, it, expect } from "vitest";
import { terminalHeadModel, isActiveSession } from "@/lib/terminalHeader";
import type { SessionMeta, SessionState } from "@/server/types";

const base: SessionMeta = {
  kind: "ticket",
  id: "mojito-RIC-174-work",
  ticket: "RIC-174",
  launchStatus: "In Progress",
  model: "opus",
  effort: "high",
  state: "running",
  cwd: "/home/mojito/code/mojito",
  createdAt: "2026-08-08T10:00:00.000Z",
  title: "Refactor header terminale",
  labels: [],
};

describe("terminalHeadModel", () => {
  it("carries every identity field of a ticket session", () => {
    expect(terminalHeadModel(base)).toEqual({
      id: "RIC-174",
      status: "In Progress",
      title: "Refactor header terminale",
      name: "RIC-174",
      killLabel: "Kill",
      killDanger: true,
    });
  });

  it("blanks id and status for a custom session, keeping the title", () => {
    const m = terminalHeadModel({ ...base, kind: "custom", ticket: "", launchStatus: "" });
    expect(m.id).toBe("");
    expect(m.status).toBe("");
    expect(m.title).toBe("Refactor header terminale");
  });

  it("falls back to the title when there is no ticket id", () => {
    const m = terminalHeadModel({ ...base, ticket: "", title: "scratch shell" });
    expect(m.name).toBe("scratch shell");
  });

  it("names a bare shell session generically", () => {
    const m = terminalHeadModel({ ...base, kind: "shell", ticket: "", launchStatus: "", title: "" });
    expect(m).toEqual({
      id: "", status: "", title: "", name: "this session",
      killLabel: "Kill", killDanger: true,
    });
  });

  it("tolerates a legacy sidecar with no title field", () => {
    const legacy = { ...base } as Partial<SessionMeta>;
    delete legacy.title;
    const m = terminalHeadModel(legacy as SessionMeta);
    expect(m.title).toBe("");
    expect(m.name).toBe("RIC-174");
  });

  it("trims whitespace-only fields to empty", () => {
    const m = terminalHeadModel({ ...base, ticket: "  ", launchStatus: "\t", title: "  " });
    expect(m).toMatchObject({ id: "", status: "", title: "", name: "this session" });
  });

  it("trims padding around real values", () => {
    const m = terminalHeadModel({ ...base, ticket: " RIC-9 ", title: " padded " });
    expect(m.id).toBe("RIC-9");
    expect(m.title).toBe("padded");
  });
});

describe("terminalHeadModel: live status", () => {
  // The header must never freeze a status on screen (RIC-203): launchStatus is a
  // launch-time snapshot, but the ticket's real status can move afterwards — including
  // by hand in Linear, which Mojito has no event for. A live status passed in from the
  // polled ticket list always wins over the snapshot.
  it("prefers a live status over the launch-time snapshot", () => {
    const m = terminalHeadModel(base, "To QA");
    expect(m.status).toBe("To QA");
  });

  it("falls back to the snapshot when no live status is available (ticket not in the open list, or a custom/shell session)", () => {
    const m = terminalHeadModel(base, undefined);
    expect(m.status).toBe("In Progress");
  });

  it("trims a live status the same way as the snapshot", () => {
    const m = terminalHeadModel(base, "  Done  ");
    expect(m.status).toBe("Done");
  });
});

describe("kill button per state", () => {
  const expected: Record<SessionState, { killLabel: string; killDanger: boolean }> = {
    starting: { killLabel: "Kill", killDanger: true },
    running: { killLabel: "Kill", killDanger: true },
    idle: { killLabel: "Kill", killDanger: true },
    "needs-input": { killLabel: "Kill", killDanger: true },
    done: { killLabel: "Dismiss", killDanger: false },
    failed: { killLabel: "Dismiss", killDanger: false },
  };

  for (const [state, want] of Object.entries(expected) as [SessionState, typeof expected[SessionState]][]) {
    it(`labels a ${state} session "${want.killLabel}"`, () => {
      expect(terminalHeadModel({ ...base, state })).toMatchObject(want);
      expect(isActiveSession(state)).toBe(want.killDanger);
    });
  }
});
