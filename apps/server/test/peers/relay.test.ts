import { describe, expect, it, vi } from "vitest";
import { matchRelay, relayRequest, RELAY_TIMEOUT_MS } from "../../src/peers/relay";

describe("matchRelay", () => {
  it("maps every allowlisted shape to its peer path", () => {
    expect(matchRelay("GET", ["sessions", "mj-a", "image"])).toBe("/api/sessions/mj-a/image");
    expect(matchRelay("POST", ["sessions", "mj-a", "images"])).toBe("/api/sessions/mj-a/images");
    expect(matchRelay("GET", ["projects", "Web", "git", "graph"])).toBe("/api/projects/Web/git/graph");
    expect(matchRelay("GET", ["projects", "Web", "git", "commits", "abc123"])).toBe("/api/projects/Web/git/commits/abc123");
    expect(matchRelay("GET", ["projects", "Web", "git", "commits", "abc123", "diff"])).toBe(
      "/api/projects/Web/git/commits/abc123/diff",
    );
    expect(matchRelay("GET", ["projects", "Web", "docs"])).toBe("/api/projects/Web/docs");
    expect(matchRelay("GET", ["projects", "Web", "docs", "file"])).toBe("/api/projects/Web/docs/file");
  });

  it("decodes a param and encodes it again", () => {
    expect(matchRelay("GET", ["projects", "my%20proj", "docs"])).toBe("/api/projects/my%20proj/docs");
    expect(matchRelay("GET", ["projects", "caf%C3%A9", "docs"])).toBe("/api/projects/caf%C3%A9/docs");
  });

  it("refuses a param that could reach another route", () => {
    expect(matchRelay("GET", ["sessions", "..%2F..%2Fsettings", "image"])).toBeNull();
    expect(matchRelay("GET", ["sessions", "a%2Fb", "image"])).toBeNull();
    expect(matchRelay("GET", ["sessions", "..", "image"])).toBeNull();
    expect(matchRelay("GET", ["sessions", ".", "image"])).toBeNull();
    expect(matchRelay("GET", ["sessions", "", "image"])).toBeNull();
    expect(matchRelay("GET", ["sessions", "%E0%A4%A", "image"])).toBeNull();
  });

  it("refuses anything off the allowlist", () => {
    // No Kill and no remove: a peer's sessions are quit in their terminal, and forgotten on the peer.
    expect(matchRelay("DELETE", ["sessions", "mj-a"])).toBeNull();
    expect(matchRelay("PUT", ["settings"])).toBeNull();
    expect(matchRelay("POST", ["hook"])).toBeNull();
    expect(matchRelay("GET", ["sessions", "mj-a"])).toBeNull();
    expect(matchRelay("POST", ["sessions", "mj-a", "image"])).toBeNull();
    expect(matchRelay("GET", ["projects", "Web", "git", "graph", "extra"])).toBeNull();
    expect(matchRelay("POST", ["projects", "Web", "docs"])).toBeNull();
    expect(matchRelay("GET", [])).toBeNull();
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

  it("a peer that never answers is a 504", async () => {
    const neverAnswers = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new DOMException("aborted", "AbortError")));
        }),
    ) as unknown as typeof fetch;
    const res = await relayRequest(PEER, "tok", REQ, { fetch: neverAnswers, timeoutMs: 20 });
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ error: "mac did not answer within 30 s" });
    expect(RELAY_TIMEOUT_MS).toBe(30_000);
  });

  // The limit is the peer's answer (its headers), not the transfer: a big image still arriving
  // after it must come through whole.
  it("does not cut a body that is still streaming after the limit", async () => {
    let signal: AbortSignal | undefined;
    const slowBody = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(new TextEncoder().encode("first,"));
          await new Promise((resolve) => setTimeout(resolve, 100));
          if (signal?.aborted) return controller.error(signal.reason);
          controller.enqueue(new TextEncoder().encode("second"));
          controller.close();
        },
      });
      return new Response(stream, { headers: { "content-type": "text/plain" } });
    }) as unknown as typeof fetch;
    const res = await relayRequest(PEER, "tok", REQ, { fetch: slowBody, timeoutMs: 30 });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("first,second");
    expect(signal?.aborted).toBe(false);
  });
});
