import { describe, expect, it, vi } from "vitest";
import { matchRelay, relayRequest, RELAY_TIMEOUT_MS } from "../../src/peers/relay";

const q = (s = "") => new URLSearchParams(s);

describe("matchRelay", () => {
  it("maps every allowlisted shape to its peer path", () => {
    expect(matchRelay("GET", ["sessions", "mj-a", "image"], q("path=x.png"))).toBe("/api/sessions/mj-a/image");
    expect(matchRelay("DELETE", ["sessions", "mj-a"], q())).toBe("/api/sessions/mj-a");
    expect(matchRelay("POST", ["sessions", "mj-a", "images"], q())).toBe("/api/sessions/mj-a/images");
    expect(matchRelay("GET", ["projects", "Web", "git", "graph"], q("skip=200"))).toBe("/api/projects/Web/git/graph");
    expect(matchRelay("GET", ["projects", "Web", "git", "commits", "abc123"], q())).toBe("/api/projects/Web/git/commits/abc123");
    expect(matchRelay("GET", ["projects", "Web", "git", "commits", "abc123", "diff"], q("path=a.ts"))).toBe(
      "/api/projects/Web/git/commits/abc123/diff",
    );
    expect(matchRelay("GET", ["projects", "Web", "docs"], q())).toBe("/api/projects/Web/docs");
    expect(matchRelay("GET", ["projects", "Web", "docs", "file"], q("path=a.md"))).toBe("/api/projects/Web/docs/file");
  });

  it("decodes a param and encodes it again", () => {
    expect(matchRelay("GET", ["projects", "my%20proj", "docs"], q())).toBe("/api/projects/my%20proj/docs");
    expect(matchRelay("GET", ["projects", "caf%C3%A9", "docs"], q())).toBe("/api/projects/caf%C3%A9/docs");
  });

  it("refuses a param that could reach another route", () => {
    expect(matchRelay("GET", ["sessions", "..%2F..%2Fsettings", "image"], q())).toBeNull();
    expect(matchRelay("GET", ["sessions", "a%2Fb", "image"], q())).toBeNull();
    expect(matchRelay("GET", ["sessions", "..", "image"], q())).toBeNull();
    expect(matchRelay("GET", ["sessions", ".", "image"], q())).toBeNull();
    expect(matchRelay("GET", ["sessions", "", "image"], q())).toBeNull();
    expect(matchRelay("GET", ["sessions", "%E0%A4%A", "image"], q())).toBeNull();
  });

  it("refuses anything off the allowlist", () => {
    expect(matchRelay("DELETE", ["sessions", "mj-a"], q("remove=1"))).toBeNull();
    expect(matchRelay("PUT", ["settings"], q())).toBeNull();
    expect(matchRelay("POST", ["hook"], q())).toBeNull();
    expect(matchRelay("GET", ["sessions", "mj-a"], q())).toBeNull();
    expect(matchRelay("POST", ["sessions", "mj-a", "image"], q())).toBeNull();
    expect(matchRelay("GET", ["projects", "Web", "git", "graph", "extra"], q())).toBeNull();
    expect(matchRelay("POST", ["projects", "Web", "docs"], q())).toBeNull();
    expect(matchRelay("GET", [], q())).toBeNull();
  });
});

const PEER = { name: "mac", url: "https://mac.t.ts.net" };
const REQ = { method: "GET", peerPath: "/api/sessions/mj-a/image", search: "?path=a.png", contentType: null, body: null };
const answering = (res: () => Response | Promise<Response>) =>
  vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => res()) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

describe("relayRequest", () => {
  it("sends only the token (and the content type) to the peer's url", async () => {
    const fetch = answering(() => new Response("x"));
    await relayRequest(PEER, "tok", { ...REQ, method: "DELETE", peerPath: "/api/sessions/mj-a", search: "", contentType: "text/plain" }, { fetch });
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://mac.t.ts.net/api/sessions/mj-a");
    expect(init.method).toBe("DELETE");
    expect(Object.fromEntries(new Headers(init.headers))).toEqual({ "x-mojito-token": "tok", "content-type": "text/plain" });
  });

  it("streams a body with duplex half", async () => {
    const fetch = answering(() => new Response("{}", { headers: { "content-type": "application/json" } }));
    const body = new Response("abc").body;
    await relayRequest(PEER, "tok", { ...REQ, method: "POST", body }, { fetch });
    const init = (fetch.mock.calls[0] as [string, RequestInit & { duplex?: string }])[1];
    expect(init.body).toBe(body);
    expect(init.duplex).toBe("half");
  });

  it("answers the status, the five headers and the bytes", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]);
    const fetch = answering(
      () =>
        new Response(bytes, {
          status: 200,
          headers: {
            "content-type": "image/png",
            "content-length": "7",
            "x-content-type-options": "nosniff",
            "content-security-policy": "sandbox",
            "cache-control": "no-store",
            "set-cookie": "a=b",
            "x-other": "1",
          },
        }),
    );
    const res = await relayRequest(PEER, "tok", REQ, { fetch });
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    expect(Object.fromEntries(res.headers)).toEqual({
      "content-type": "image/png",
      "content-length": "7",
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox",
      "cache-control": "no-store",
    });
  });

  it("passes a json error through", async () => {
    const fetch = answering(() => Response.json({ error: "claude did not exit" }, { status: 409 }));
    const res = await relayRequest(PEER, "tok", REQ, { fetch });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "claude did not exit" });
  });

  it("an error that is not json is a 502", async () => {
    const res = await relayRequest(PEER, "tok", REQ, { fetch: answering(() => new Response("Bad Gateway", { status: 500 })) });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "mac is not reachable" });
  });

  it("a failed fetch is a 502", async () => {
    const res = await relayRequest(PEER, "tok", REQ, {
      fetch: answering(() => {
        throw new TypeError("fetch failed");
      }),
    });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "mac is not reachable" });
  });

  it("a timeout is a 504", async () => {
    const res = await relayRequest(PEER, "tok", REQ, {
      fetch: answering(() => Promise.reject(new DOMException("timed out", "TimeoutError"))),
    });
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ error: "mac did not answer within 30 s" });
    expect(RELAY_TIMEOUT_MS).toBe(30_000);
  });
});
