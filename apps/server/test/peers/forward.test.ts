import { describe, expect, it, vi } from "vitest";
import type { LaunchBody } from "@mojito/shared";
import { forwardLaunch } from "../../src/peers/forward";

const PEER = { name: "mac", url: "https://mac.t.ts.net" };
const BODY: LaunchBody = { kind: "ticket", ticket: "RIC-7", model: "opus", effort: "high", worktree: false };

const answering = (res: () => Response | Promise<Response>) =>
  vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => res()) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

describe("forwardLaunch", () => {
  it("posts the body to the peer's /api/sessions with the token", async () => {
    const fetch = answering(() => Response.json({ session: { id: "mj-RIC-7" } }, { status: 201 }));
    await forwardLaunch(PEER, "tok", BODY, { fetch });
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://mac.t.ts.net/api/sessions");
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("x-mojito-token")).toBe("tok");
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual(BODY);
  });

  it("answers the peer's status and body verbatim", async () => {
    const created = { session: { id: "mj-RIC-7" }, warning: "Linear: assign failed" };
    expect(await forwardLaunch(PEER, "tok", BODY, { fetch: answering(() => Response.json(created, { status: 201 })) })).toEqual({
      status: 201,
      body: created,
    });
    const live = { error: "session already running", sessionId: "mj-RIC-7" };
    expect(await forwardLaunch(PEER, "tok", BODY, { fetch: answering(() => Response.json(live, { status: 409 })) })).toEqual({
      status: 409,
      body: live,
    });
    const bad = { error: "ticket not on the board: RIC-7" };
    expect(await forwardLaunch(PEER, "tok", BODY, { fetch: answering(() => Response.json(bad, { status: 400 })) })).toEqual({
      status: 400,
      body: bad,
    });
  });

  it("an unreachable peer is a 502", async () => {
    const fetch = answering(() => Promise.reject(new TypeError("fetch failed")));
    expect(await forwardLaunch(PEER, "tok", BODY, { fetch })).toEqual({ status: 502, body: { error: "mac is not reachable" } });
  });

  it("an answer that is not json is a 502", async () => {
    const fetch = answering(() => new Response("<html>Bad gateway</html>", { status: 200 }));
    expect(await forwardLaunch(PEER, "tok", BODY, { fetch })).toEqual({ status: 502, body: { error: "mac is not reachable" } });
  });

  it("no answer in time is a 504 that says the session may still be starting", async () => {
    const fetch = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    ) as unknown as typeof globalThis.fetch;
    expect(await forwardLaunch(PEER, "tok", BODY, { fetch, timeoutMs: 20 })).toEqual({
      status: 504,
      body: { error: "mac did not answer within 30 s: the session may still be starting" },
    });
  });
});
