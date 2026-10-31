import { describe, expect, it, vi } from "vitest";
import type { PeerSnapshot } from "@mojito/shared";
import type { PeerLink } from "../../src/peers/link";
import { PeerRegistry } from "../../src/peers/registry";
import { meta, setup } from "./setup";

const snapshot = (name: string, online: boolean): PeerSnapshot => ({
  name,
  url: `https://${name}.t.ts.net`,
  online,
  sessions: online ? [meta({ id: `mj-${name}-a1b2c3`, project: "Ios" })] : [],
  projects: ["Ios"],
  ticketTitles: {},
});

/** A link that only answers its snapshot: the routes never reach past it. */
const stubLink = (s: PeerSnapshot) =>
  ({ peer: { name: s.name, url: s.url }, snapshot: () => s, start: vi.fn(), stop: vi.fn() }) as unknown as PeerLink;

function withPeers(fetchImpl?: typeof fetch) {
  const peers = new PeerRegistry("box", [stubLink(snapshot("mac", true)), stubLink(snapshot("air", false))]);
  const fetch = vi.fn(fetchImpl ?? (async () => Response.json({ session: meta({ id: "mj-RIC-7" }) }, { status: 201 })));
  return { ...setup({ peers, peerFetch: fetch as unknown as typeof globalThis.fetch }), fetch };
}

const LAUNCH = { kind: "ticket", ticket: "RIC-7", model: "opus", effort: "high" };

describe("GET /api/peers", () => {
  it("answers this instance's name and the peers in order", async () => {
    const { req } = withPeers();
    const res = await req("/api/peers");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ self: "box", peers: [snapshot("mac", true), snapshot("air", false)] });
  });

  it("with no peers configured answers none", async () => {
    const { req } = setup();
    expect(await (await req("/api/peers")).json()).toEqual({ self: "box", peers: [] });
  });
});

describe("POST /api/peers/:name/sessions", () => {
  it("forwards the launch to the peer and answers what it answered", async () => {
    const { req, fetch } = withPeers();
    const res = await req("/api/peers/mac/sessions", { method: "POST", json: LAUNCH });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ session: meta({ id: "mj-RIC-7" }) });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("https://mac.t.ts.net/api/sessions");
  });

  it("passes a peer's 409 through, sessionId included", async () => {
    const { req } = withPeers(async () => Response.json({ error: "already running", sessionId: "mj-RIC-7" }, { status: 409 }));
    const res = await req("/api/peers/mac/sessions", { method: "POST", json: LAUNCH });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "already running", sessionId: "mj-RIC-7" });
  });

  it("an unknown peer is a 404", async () => {
    const { req, fetch } = withPeers();
    const res = await req("/api/peers/nope/sessions", { method: "POST", json: LAUNCH });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "peer not found: nope" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("an invalid body is a 400 and nothing is sent", async () => {
    const { req, fetch } = withPeers();
    const res = await req("/api/peers/mac/sessions", { method: "POST", json: { kind: "ticket", ticket: "nope" } });
    expect(res.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("an offline peer is a 502 and nothing is sent", async () => {
    const { req, fetch } = withPeers();
    const res = await req("/api/peers/air/sessions", { method: "POST", json: LAUNCH });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "air is not reachable" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("with no peers configured every name is unknown", async () => {
    const { req } = setup();
    expect((await req("/api/peers/mac/sessions", { method: "POST", json: LAUNCH })).status).toBe(404);
  });
});

describe("PeerRegistry", () => {
  it("starts and stops every link", () => {
    const links = [stubLink(snapshot("mac", true)), stubLink(snapshot("air", false))];
    const reg = new PeerRegistry("box", links);
    reg.start();
    reg.stop();
    for (const l of links) {
      expect(l.start).toHaveBeenCalledTimes(1);
      expect(l.stop).toHaveBeenCalledTimes(1);
    }
    expect(reg.config("mac")).toEqual({ name: "mac", url: "https://mac.t.ts.net" });
    expect(reg.config("nope")).toBeUndefined();
    expect(reg.online("mac")).toBe(true);
    expect(reg.online("air")).toBe(false);
    expect(reg.online("nope")).toBe(false);
  });
});
