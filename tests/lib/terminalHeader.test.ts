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
      ticketUrl: "",
      warp: "warp://action/new_tab?path=%2Fhome%2Fmojito%2Fcode%2Fmojito",
      vscode: "vscode://file/home/mojito/code/mojito/",
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
      ticketUrl: "",
      warp: "warp://action/new_tab?path=%2Fhome%2Fmojito%2Fcode%2Fmojito",
      vscode: "vscode://file/home/mojito/code/mojito/",
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
    const m = terminalHeadModel(base, { statusName: "To QA" });
    expect(m.status).toBe("To QA");
  });

  it("falls back to the snapshot when no live status is available (ticket not in the open list, or a custom/shell session)", () => {
    const m = terminalHeadModel(base, undefined);
    expect(m.status).toBe("In Progress");
  });

  it("trims a live status the same way as the snapshot", () => {
    const m = terminalHeadModel(base, { statusName: "  Done  " });
    expect(m.status).toBe("Done");
  });
});

describe("terminalHeadModel: the ticket's Linear url", () => {
  // Only the polled ticket list has it, so a session whose ticket is not in it — a
  // custom session, or a ticket already Done — renders its id as plain text. Mojito
  // has no workspace slug to build a url from, and a guessed one is worse than none.
  it("carries the url of the live ticket", () => {
    const m = terminalHeadModel(base, { statusName: "Todo", url: "https://linear.app/acme/issue/RIC-174" });
    expect(m.ticketUrl).toBe("https://linear.app/acme/issue/RIC-174");
  });

  it("is empty with no live ticket", () => {
    expect(terminalHeadModel(base).ticketUrl).toBe("");
  });

  it("is empty when the live ticket has no url (a legacy cached list)", () => {
    expect(terminalHeadModel(base, { statusName: "Todo" }).ticketUrl).toBe("");
  });

  it("trims a padded url", () => {
    const m = terminalHeadModel(base, { url: "  https://linear.app/acme/issue/RIC-174  " });
    expect(m.ticketUrl).toBe("https://linear.app/acme/issue/RIC-174");
  });
});

describe("terminalHeadModel: open elsewhere", () => {
  it("points Warp and VS Code at the session's own cwd — a worktree included", () => {
    const wt = "/home/mojito/code/mojito/.claude/worktrees/RIC-174-header";
    const m = terminalHeadModel({ ...base, cwd: wt });
    expect(m.warp).toBe(`warp://action/new_tab?path=${encodeURIComponent(wt)}`);
    expect(m.vscode).toBe(`vscode://file${wt}/`);
  });

  it("has no links for a session with no usable path, so the header can skip them", () => {
    const m = terminalHeadModel({ ...base, cwd: "" });
    expect(m.warp).toBe("");
    expect(m.vscode).toBe("");
  });

  it("tolerates a legacy sidecar with no cwd field", () => {
    const legacy = { ...base } as Partial<SessionMeta>;
    delete legacy.cwd;
    const m = terminalHeadModel(legacy as SessionMeta);
    expect(m.warp).toBe("");
    expect(m.vscode).toBe("");
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
