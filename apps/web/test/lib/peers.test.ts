import { describe, expect, it } from "vitest";
import type { PeerSnapshot, PeersAnswer, SessionMeta } from "@mojito/shared";
import { appTitle, freeLaunchHosts, freeLaunchProjects, launchHosts, peerHref, peerSessionForTicket, replacePeer, waitingPeers, withPeerSession } from "@/lib/peers";

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
  title: null,
  endReason: null,
  claudeSessionId: null,
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

describe("freeLaunchProjects", () => {
  it("is this instance's projects and every online peer's, once each, by name", () => {
    const projects = freeLaunchProjects(["Web", "api"], [
      peer("mac", ["Web", "Ios"]),
      peer("air", ["Old"], { online: false }),
      peer("mini", ["Ios", "Zed"]),
    ]);
    expect(projects).toEqual(["api", "Ios", "Web", "Zed"]);
  });
});

describe("freeLaunchHosts", () => {
  const peers = [peer("mac", ["Web"]), peer("air", ["Web"], { online: false }), peer("mini", ["Ios"])];

  it("is this instance first when it maps the project, then the online peers that map it", () => {
    expect(freeLaunchHosts("Web", "box", ["Web"], peers).map((h) => h.name)).toEqual(["box", "mac"]);
  });

  it("leaves this instance out when the project is only on a peer", () => {
    const hosts = freeLaunchHosts("Ios", "box", ["Web"], peers);
    expect(hosts.map((h) => h.name)).toEqual(["mini"]);
    expect(hosts[0].peer?.name).toBe("mini");
  });

  it("General runs anywhere online", () => {
    expect(freeLaunchHosts(null, "box", [], peers).map((h) => h.name)).toEqual(["box", "mac", "mini"]);
  });
});

describe("waitingPeers", () => {
  it("is true when a peer has a session asking for input", () => {
    expect(waitingPeers([peer("mac", [], { sessions: [session("mj-a", { state: "needs-input" })] })])).toBe(true);
  });

  it("is false for a peer with none waiting, and for no peers", () => {
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

describe("appTitle", () => {
  it("is Mojito until this instance's name is known", () => {
    expect(appTitle(undefined)).toBe("Mojito");
    expect(appTitle("")).toBe("Mojito");
  });

  it("names this instance first", () => {
    expect(appTitle("ai-tonic")).toBe("ai-tonic · Mojito");
  });
});

describe("withPeerSession", () => {
  const answer: PeersAnswer = { self: "box", peers: [peer("mac", ["Web"]), peer("air", ["Web"])] };

  it("adds the session to that peer's snapshot only", () => {
    const s = session("mj-RIC-1", { kind: "ticket", ticket: "RIC-1", state: "starting" });
    expect(withPeerSession(answer, "mac", s)).toEqual({
      self: "box",
      peers: [peer("mac", ["Web"], { sessions: [s] }), peer("air", ["Web"])],
    });
  });

  it("leaves an unknown peer and an unloaded answer alone", () => {
    const s = session("mj-RIC-1");
    expect(withPeerSession(answer, "mini", s)).toBe(answer);
    expect(withPeerSession(undefined, "mac", s)).toBeUndefined();
  });
});
