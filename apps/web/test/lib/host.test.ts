import { describe, expect, it } from "vitest";
import type { PeerSnapshot, PeersAnswer } from "@mojito/shared";
import { hostApi, hostOf, ptyPath, resolveHost, sessionHref } from "@/lib/host";

const mac: PeerSnapshot = {
  name: "mac",
  url: "https://mac.t.ts.net",
  online: true,
  sessions: [],
  projects: [],
  ticketTitles: {},
};
const answer: PeersAnswer = { self: "box", peers: [mac] };

describe("resolveHost", () => {
  it("is this instance with no host, without waiting for the peers", () => {
    expect(resolveHost(null, undefined)).toEqual({ kind: "self" });
    expect(resolveHost("", undefined)).toEqual({ kind: "self" });
  });

  it("waits for the peers answer when a host is named", () => {
    expect(resolveHost("mac", undefined)).toEqual({ kind: "loading" });
  });

  it("is this instance only when the host equals its own name", () => {
    expect(resolveHost("box", { self: "box", peers: [] })).toEqual({ kind: "self" });
  });

  it("finds a peer by name", () => {
    expect(resolveHost("mac", answer)).toEqual({ kind: "peer", peer: mac });
  });

  it("never falls back to this instance for an unknown name", () => {
    expect(resolveHost("192.168.1.5", answer)).toEqual({ kind: "unknown", name: "192.168.1.5" });
  });
});

describe("hostApi", () => {
  it("leaves a local path alone", () => {
    expect(hostApi(null, "/api/sessions/mj-a")).toBe("/api/sessions/mj-a");
  });

  it("routes a peer's path through the relay", () => {
    expect(hostApi("mac", "/api/sessions/mj-a/image?path=x")).toBe("/api/peers/mac/sessions/mj-a/image?path=x");
  });

  it("encodes the host name", () => {
    expect(hostApi("a b", "/api/x")).toBe("/api/peers/a%20b/x");
  });
});

describe("ptyPath", () => {
  it("is the local gateway with no host", () => {
    expect(ptyPath(null, "mj-a")).toBe("/ws/pty/mj-a");
  });

  it("is the relay for a peer", () => {
    expect(ptyPath("mac", "mj-a")).toBe("/ws/peers/mac/pty/mj-a");
  });
});

describe("sessionHref", () => {
  it("has no host for a local session", () => {
    expect(sessionHref(null, "mj-a")).toBe("/session/mj-a");
  });

  it("carries the host of a peer's session", () => {
    expect(sessionHref("mac", "mj-a")).toBe("/session/mj-a?host=mac");
  });
});

describe("hostOf", () => {
  it("is the peer's name, else null", () => {
    expect(hostOf({ kind: "peer", peer: mac })).toBe("mac");
    expect(hostOf({ kind: "self" })).toBeNull();
    expect(hostOf({ kind: "loading" })).toBeNull();
    expect(hostOf({ kind: "unknown", name: "x" })).toBeNull();
  });
});
