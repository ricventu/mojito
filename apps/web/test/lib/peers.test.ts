import { describe, expect, it } from "vitest";
import type { PeerSnapshot, PeersAnswer, SessionMeta } from "@mojito/shared";
import { launchHosts, peerHref, peerSessionForTicket, replacePeer, waitingPeers } from "@/lib/peers";

const session = (id: string, over: Partial<SessionMeta> = {}): SessionMeta => ({
  id,
  kind: "claude",
  project: null,
  ticket: null,
  cwd: "/repo",
  model: "opus",
  effort: "high",
  state: "running",
  alert: null,
  createdAt: 1,
  lastEventAt: 1,
  hidden: false,
  title: null,
  ...over,
});

const peer = (name: string, projects: string[], over: Partial<PeerSnapshot> = {}): PeerSnapshot => ({
  name,
  url: `https://${name}.t.ts.net`,
  online: true,
  sessions: [],
  projects,
  ticketTitles: {},
  ...over,
});

describe("peerHref", () => {
  it("joins the peer's url, the path and the encoded token", () => {
    expect(peerHref({ url: "https://mac.t.ts.net" }, "/session/mj-RIC-7", "a+b=")).toBe(
      "https://mac.t.ts.net/session/mj-RIC-7?token=a%2Bb%3D",
    );
    expect(peerHref({ url: "https://mac.t.ts.net" }, "/", "t")).toBe("https://mac.t.ts.net/?token=t");
  });
});

describe("launchHosts", () => {
  it("is this instance first, then the online peers that map the ticket's project, in order", () => {
    const hosts = launchHosts({ project: "Web" }, "box", [
      peer("mac", ["Web"]),
      peer("air", ["Web"], { online: false }),
      peer("ios", ["Ios"]),
      peer("mini", ["Web", "Ios"]),
    ]);
    expect(hosts.map((h) => h.name)).toEqual(["box", "mac", "mini"]);
    expect(hosts[0].peer).toBeNull();
    expect(hosts[1].peer?.name).toBe("mac");
  });

  it("a ticket with no project runs here only", () => {
    expect(launchHosts({ project: null }, "box", [peer("mac", ["Web"])]).map((h) => h.name)).toEqual(["box"]);
  });
});

describe("waitingPeers", () => {
  it("is true when a peer has a visible session asking for input", () => {
    expect(waitingPeers([peer("mac", [], { sessions: [session("mj-a", { state: "needs-input" })] })])).toBe(true);
  });

  it("ignores a hidden one, and a peer with none", () => {
    expect(waitingPeers([peer("mac", [], { sessions: [session("mj-a", { state: "needs-input", hidden: true })] })])).toBe(false);
    expect(waitingPeers([peer("mac", [], { sessions: [session("mj-a")] })])).toBe(false);
    expect(waitingPeers([])).toBe(false);
  });
});

describe("peerSessionForTicket", () => {
  const live = session("mj-RIC-7", { kind: "ticket", ticket: "RIC-7" });

  it("finds the ticket's live session on a peer", () => {
    const mac = peer("mac", ["Web"], { sessions: [session("mj-x"), live] });
    expect(peerSessionForTicket([peer("air", []), mac], "RIC-7")).toEqual({ peer: mac, session: live });
  });

  it("is null when no peer runs it", () => {
    expect(peerSessionForTicket([peer("mac", [], { sessions: [session("mj-x")] })], "RIC-7")).toBeNull();
    expect(peerSessionForTicket([], "RIC-7")).toBeNull();
  });
});

describe("replacePeer", () => {
  const answer: PeersAnswer = { self: "box", peers: [peer("mac", []), peer("air", [])] };

  it("replaces the peer by name, keeping the order", () => {
    const next = peer("mac", ["Web"], { online: false });
    expect(replacePeer(answer, next)).toEqual({ self: "box", peers: [next, peer("air", [])] });
  });

  it("returns an unknown peer's answer, and no answer, unchanged", () => {
    expect(replacePeer(answer, peer("nope", []))).toBe(answer);
    expect(replacePeer(undefined, peer("mac", []))).toBeUndefined();
  });
});
