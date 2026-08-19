import { describe, it, expect, vi, afterEach } from "vitest";
import { dismissSession } from "@/lib/dismissSession";

function stubFetch(res: { ok: boolean; body?: unknown }) {
  const fetchMock = vi.fn(async () => ({
    ok: res.ok,
    json: async () => {
      if (res.body === undefined) throw new Error("not json");
      return res.body;
    },
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("dismissSession", () => {
  it("reports nothing when the session was closed and forgotten", async () => {
    const fetchMock = stubFetch({ ok: true });
    expect(await dismissSession("tok", "mojito-RIC-46-work")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sessions/mojito-RIC-46-work",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("passes the server's refusal through", async () => {
    // The 409 the route answers with when claude would not exit. Swallowing it is
    // what made a refused dismiss indistinguishable from a successful one.
    stubFetch({ ok: false, body: { error: "claude is still running in this session" } });
    expect(await dismissSession("tok", "mojito-RIC-46-work")).toBe("claude is still running in this session");
  });

  it("still reports a failure whose body is not json", async () => {
    stubFetch({ ok: false });
    expect(await dismissSession("tok", "mojito-RIC-46-work")).toBe("could not close the session");
  });
});
