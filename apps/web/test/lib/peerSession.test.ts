import { describe, expect, it } from "vitest";
import type { PeerSnapshot, SessionMeta } from "@mojito/shared";
import { exitAction, pageSession, peerSessionView } from "@/lib/peerSession";

const a: SessionMeta = {
  id: "mj-a",
  kind: "ticket",
  project: "p",
  ticket: "RIC-1",
  cwd: "/x",
  model: null,
  effort: null,
  state: "idle",
  alert: null,
  createdAt: 1,
  lastEventAt: 1,
  title: null,
  endReason: null,
  claudeSessionId: null,
};
const peer = (online: boolean, sessions: SessionMeta[]): PeerSnapshot => ({
  name: "mac",
  url: "https://mac.t.ts.net",
  online,
  sessions,
  projects: [],
  ticketTitles: {},
});

describe("peerSessionView", () => {
  it("takes the snapshot's row for the id", () => {
    expect(peerSessionView(peer(true, [a]), "mj-a", null).session).toBe(a);
  });

  it("keeps the last known row when the snapshot has none", () => {
    expect(peerSessionView(peer(true, []), "mj-a", a)).toEqual({ session: a, offline: false });
  });

  it("says offline, and still shows the last known row", () => {
    expect(peerSessionView(peer(false, []), "mj-a", a)).toEqual({ session: a, offline: true });
  });

  it("has no session when none was ever seen", () => {
    expect(peerSessionView(peer(true, []), "mj-a", null)).toEqual({ session: null, offline: false });
  });
});

describe("pageSession", () => {
  const local: SessionMeta = { ...a, cwd: "/local" };
  const remote: SessionMeta = { ...a, cwd: "/remote" };

  it("reads this instance's list only for self", () => {
    expect(pageSession({ kind: "self" }, [local], "mj-a", null)).toBe(local);
    expect(pageSession({ kind: "self" }, undefined, "mj-a", null)).toBeNull();
  });

  it("never takes a local row while the host is loading", () => {
    expect(pageSession({ kind: "loading" }, [local], "mj-a", null)).toBeNull();
  });

  it("never takes a local row for an unknown host", () => {
    expect(pageSession({ kind: "unknown", name: "x" }, [local], "mj-a", null)).toBeNull();
  });

  it("takes a peer's snapshot row, else the last known, never the local one", () => {
    expect(pageSession({ kind: "peer", peer: peer(true, [remote]) }, [local], "mj-a", null)).toBe(remote);
    expect(pageSession({ kind: "peer", peer: peer(true, []) }, [local], "mj-a", a)).toBe(a);
    expect(pageSession({ kind: "peer", peer: peer(true, []) }, [local], "mj-a", null)).toBeNull();
  });
});

describe("exitAction", () => {
  it("shows the ended panel for a local session", () => {
    expect(exitAction(null, false)).toBe("ended");
  });

  it("shows the ended panel for a peer session that was seen", () => {
    expect(exitAction("mac", true)).toBe("ended");
  });

  it("goes to the board for a peer session that never existed", () => {
    expect(exitAction("mac", false)).toBe("board");
  });
});
