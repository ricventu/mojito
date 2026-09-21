import { describe, it, expect } from "vitest";
import { sidebarItem, sidebarSessions } from "@/lib/sidebarSessions";
import type { SessionMeta, SessionState } from "@/server/types";

function s(
  id: string,
  ticket: string,
  createdAt: string,
  state: SessionState = "running",
  projectName = "",
): SessionMeta {
  return {
    kind: "ticket", id, ticket, createdAt, state, projectName,
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

  // The order rests on nothing that changes while a session is alive. It shipped with
  // needs-input split off the front, which made a row jump to the top and back down as
  // its session asked and was answered — the card you were reaching for moved under
  // your finger. The signal is the row's own badge and styling instead.
  it("leaves a session waiting for an answer where it is", () => {
    const list = [
      s("a", "RIC-1", T(12)),
      s("b", "RIC-2", T(9), "needs-input"),
      s("c", "RIC-3", T(11)),
    ];
    expect(sidebarSessions(list).map((x) => x.id)).toEqual(["a", "c", "b"]);
  });

  it("orders newest-first, clustering a ticket's own sessions", () => {
    const list = [
      s("old", "RIC-1", T(8)),
      s("new", "RIC-2", T(12)),
      s("mid", "RIC-1", T(10)),
    ];
    expect(sidebarSessions(list).map((x) => x.id)).toEqual(["new", "mid", "old"]);
  });

  // The sidebar is unfiltered, so a machine working two repos at once interleaved them
  // and the sessions of the repo you are in were scattered down a list ordered by clock.
  it("keeps a project's sessions together", () => {
    const list = [
      s("a1", "RIC-1", T(12), "running", "alpha"),
      s("b1", "RIC-2", T(11), "running", "beta"),
      s("a2", "RIC-3", T(10), "running", "alpha"),
      s("b2", "RIC-4", T(9), "running", "beta"),
    ];
    expect(sidebarSessions(list).map((x) => x.id)).toEqual(["a1", "a2", "b1", "b2"]);
  });

  // A freshly launched session brings its project up — at launch, the one moment the
  // list is allowed to rearrange.
  it("orders the groups by their newest session", () => {
    const list = [
      s("a1", "RIC-1", T(8), "running", "alpha"),
      s("b1", "RIC-2", T(9), "running", "beta"),
      s("b2", "RIC-3", T(12), "running", "beta"),
    ];
    expect(sidebarSessions(list).map((x) => x.id)).toEqual(["b2", "b1", "a1"]);
  });

  // A General launch has no project; it is simply the "" group, by the same rule.
  it("groups the project-less sessions together too", () => {
    const list = [
      s("g1", "", T(12), "running", ""),
      s("a1", "RIC-1", T(11), "running", "alpha"),
      s("g2", "", T(10), "running", ""),
    ];
    expect(sidebarSessions(list).map((x) => x.id)).toEqual(["g1", "g2", "a1"]);
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
