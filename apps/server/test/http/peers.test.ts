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

describe("ALL /api/peers/:name/*", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]);
  const IMAGE = "/api/peers/mac/sessions/mj-a/image?path=a.png";

  it("relays an image read with the token alone and passes the safe headers back", async () => {
    const { req, fetch } = withPeers(
      async () =>
        new Response(PNG, {
          headers: {
            "content-type": "image/png",
            "x-content-type-options": "nosniff",
            "content-security-policy": "sandbox; default-src 'none'",
            "cache-control": "no-store",
            "set-cookie": "a=b",
          },
        }),
    );
    const res = await req(IMAGE, { headers: { cookie: "x" } });
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://mac.t.ts.net/api/sessions/mj-a/image?path=a.png");
    expect(Object.fromEntries(new Headers(init.headers))).toEqual({ "x-mojito-token": "tok" });
  });

  it("passes the peer's answer to a kill verbatim", async () => {
    const { req, fetch } = withPeers(async () => Response.json({ error: "claude did not exit: open the terminal" }, { status: 409 }));
    const res = await req("/api/peers/mac/sessions/mj-a", { method: "DELETE" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "claude did not exit: open the terminal" });
    expect((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe("DELETE");
  });

  it("streams an upload through with its content type and bytes", async () => {
    let seen: { type: string | null; bytes: Uint8Array } | null = null;
    const { app, fetch } = withPeers(async (_url, init) => {
      const r = new Response(init?.body as ReadableStream, { headers: new Headers(init?.headers) });
      seen = { type: r.headers.get("content-type"), bytes: new Uint8Array(await r.arrayBuffer()) };
      return Response.json({ paths: ["/p/1.png"] });
    });
    const form = new FormData();
    form.append("files", new File([PNG], "a.png", { type: "image/png" }));
    const sent = new Response(form);
    const type = sent.headers.get("content-type")!;
    const bytes = new Uint8Array(await sent.arrayBuffer());
    const res = await app.request("/api/peers/mac/sessions/mj-a/images", {
      method: "POST",
      headers: { "x-mojito-token": "tok", "content-type": type },
      body: bytes,
    });
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(seen!.type).toBe(type);
    expect(seen!.bytes).toEqual(bytes);
  });

  it("refuses a param that climbs out of its segment", async () => {
    const { req, fetch } = withPeers();
    const res = await req("/api/peers/mac/sessions/..%2F..%2Fsettings/image");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses what is off the allowlist", async () => {
    const { req, fetch } = withPeers();
    const res = await req("/api/peers/mac/settings", { method: "PUT", json: {} });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("an unknown peer is a 404", async () => {
    const { req, fetch } = withPeers();
    const res = await req("/api/peers/nope/sessions/mj-a/image?path=a.png");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "peer not found: nope" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("an offline peer is a 502 and nothing is sent", async () => {
    const { req, fetch } = withPeers();
    const res = await req("/api/peers/air/sessions/mj-a/image?path=a.png");
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "air is not reachable" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a failing fetch is a 502, a timeout a 504", async () => {
    const down = withPeers(async () => {
      throw new TypeError("fetch failed");
    });
    const a = await down.req(IMAGE);
    expect(a.status).toBe(502);
    expect(await a.json()).toEqual({ error: "mac is not reachable" });

    // A peer that never answers: the relay's own timer aborts the request after 30 s.
    vi.useFakeTimers();
    try {
      const slow = withPeers(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
          }),
      );
      const pending = slow.req(IMAGE);
      await vi.advanceTimersByTimeAsync(30_000);
      const b = await pending;
      expect(b.status).toBe(504);
      expect(await b.json()).toEqual({ error: "mac did not answer within 30 s" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("a peer's error that is not json is a 502", async () => {
    const { req } = withPeers(async () => new Response("boom", { status: 500 }));
    expect((await req(IMAGE)).status).toBe(502);
  });

  it("without the token nothing is relayed", async () => {
    const { app, fetch } = withPeers();
    expect((await app.request(IMAGE)).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
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
