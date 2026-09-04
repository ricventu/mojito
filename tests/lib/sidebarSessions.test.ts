import { describe, it, expect } from "vitest";
import { sidebarItem, sidebarSessions } from "@/lib/sidebarSessions";
import type { SessionMeta, SessionState } from "@/server/types";

function s(id: string, ticket: string, createdAt: string, state: SessionState = "running"): SessionMeta {
  return {
    kind: "ticket", id, ticket, createdAt, state,
    launchStatus: "", model: "", effort: "low", cwd: "", title: "", labels: [],
  } as SessionMeta;
}

const T = (h: number) => `2026-09-04T${String(h).padStart(2, "0")}:00:00.000Z`;

describe("sidebarSessions", () => {
  // The predicate this got wrong first time round. A ticket session goes to "done" on
  // every Stop once its result file says ready-for-qa, and stays there for the whole of
  // the QA gate — with its tmux up, because Mojito never ends a session and that one is
  // the rework channel the gate depends on. Keying on the state hid exactly the session
  // a switcher exists to switch to, and made the row flicker in and out at every turn.
  // unifiedRows.ts settled the same question for the board's Sessions filter.
  it("lists a finished session, whose tmux is still up", () => {
    const list = [
      s("a", "RIC-1", T(10), "done"),
      s("b", "RIC-2", T(11), "running"),
      s("c", "RIC-3", T(9), "failed"),
    ];
    expect(sidebarSessions(list).map((x) => x.id)).toEqual(["b", "a", "c"]);
  });

  // The one thing worth interrupting for. Everything else is newest-first.
  it("floats the sessions waiting for an answer to the top", () => {
    const list = [
      s("a", "RIC-1", T(12)),
      s("b", "RIC-2", T(9), "needs-input"),
      s("c", "RIC-3", T(11)),
    ];
    expect(sidebarSessions(list).map((x) => x.id)).toEqual(["b", "a", "c"]);
  });

  it("orders each half newest-first, clustering a ticket's own sessions", () => {
    const list = [
      s("old", "RIC-1", T(8)),
      s("new", "RIC-2", T(12)),
      s("mid", "RIC-1", T(10)),
    ];
    expect(sidebarSessions(list).map((x) => x.id)).toEqual(["new", "mid", "old"]);
  });

  it("does not mutate its input", () => {
    const list = [s("a", "RIC-1", T(10)), s("b", "RIC-2", T(11), "needs-input")];
    const before = list.map((x) => x.id);
    sidebarSessions(list);
    expect(list.map((x) => x.id)).toEqual(before);
  });

  it("returns an empty list unchanged", () => {
    expect(sidebarSessions([])).toEqual([]);
  });
});

describe("sidebarItem", () => {
  it("leads a ticket session with its id and follows with the ticket title", () => {
    const item = sidebarItem({ ...s("a", "RIC-1", T(10)), title: "Sidebar delle sessioni" });
    expect(item).toMatchObject({ id: "a", label: "RIC-1", detail: "Sidebar delle sessioni" });
  });

  it("leads a session with no ticket with its own title", () => {
    const item = sidebarItem({ ...s("a", "", T(10)), kind: "custom", title: "poke at the pty" });
    expect(item).toMatchObject({ label: "poke at the pty", detail: "" });
  });

  it("names the kind when there is no title either", () => {
    expect(sidebarItem({ ...s("a", "", T(10)), kind: "shell", title: "" }).label).toBe("terminal");
    expect(sidebarItem({ ...s("a", "", T(10)), kind: "custom", title: "" }).label).toBe("claude");
    expect(sidebarItem({ ...s("a", "", T(10)), kind: "intake", title: "" }).label).toBe("new ticket");
  });

  it("falls back to the last alert message for the second line", () => {
    const ticket = sidebarItem({ ...s("a", "RIC-1", T(10)), title: "", message: "needs an answer" });
    expect(ticket.detail).toBe("needs an answer");
    const custom = sidebarItem({ ...s("b", "", T(10)), kind: "custom", title: "x", message: "waiting" });
    expect(custom.detail).toBe("waiting");
  });

  // Sidecars written before `title` existed leave it undefined despite the type.
  it("survives the fields an old sidecar has no value for", () => {
    const bare = { ...s("a", "", T(10)), kind: "custom" } as SessionMeta;
    delete (bare as { title?: string }).title;
    expect(sidebarItem(bare)).toMatchObject({ label: "claude", detail: "", project: "" });
  });
});
