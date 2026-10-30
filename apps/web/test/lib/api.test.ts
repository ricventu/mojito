import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiBlob, apiFetch, apiJson } from "@/lib/api";
import { clearToken, getToken, setToken } from "@/lib/token";

function respond(status: number, body: unknown, statusText = "") {
  const fetchMock = vi.fn(async () =>
    new Response(body === undefined ? null : JSON.stringify(body), { status, statusText }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("apiFetch", () => {
  beforeEach(() => { setToken("tok"); });
  afterEach(() => { vi.unstubAllGlobals(); clearToken(); });

  it("throws ApiError carrying status, message and body on a 409", async () => {
    respond(409, { error: "x", sessionId: "mj-RIC-1" });
    const err = (await apiFetch("/api/sessions").catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.message).toBe("x");
    expect(err.body).toEqual({ error: "x", sessionId: "mj-RIC-1" });
  });

  it("falls back to statusText when the body has no error", async () => {
    respond(502, undefined, "Bad Gateway");
    const err = await apiFetch("/api/tickets").catch((e: unknown) => e as ApiError);
    expect(err).toMatchObject({ status: 502, message: "Bad Gateway" });
  });

  it("sends the token and parses the json answer", async () => {
    const f = respond(200, { ok: true });
    await expect(apiFetch("/api/health")).resolves.toEqual({ ok: true });
    const [path, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/api/health");
    expect(new Headers(init.headers).get("x-mojito-token")).toBe("tok");
  });

  it("does not set a content-type on a FormData body", async () => {
    const f = respond(200, {});
    await apiFetch("/api/tickets", { method: "POST", body: new FormData() });
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(new Headers(init.headers).has("content-type")).toBe(false);
  });

  it("clears the stored token on a 401, so the gate shows again", async () => {
    respond(401, { error: "unauthorized" });
    await expect(apiFetch("/api/tickets")).rejects.toMatchObject({ status: 401 });
    expect(getToken()).toBe("");
  });

  it("answers undefined for an empty body", async () => {
    respond(204, undefined);
    await expect(apiFetch("/api/sessions/x", { method: "DELETE" })).resolves.toBeUndefined();
  });
});

describe("apiJson", () => {
  beforeEach(() => { setToken("tok"); });
  afterEach(() => { vi.unstubAllGlobals(); clearToken(); });

  it("stringifies the body and sets the content-type", async () => {
    const f = respond(201, { id: "a" });
    await expect(apiJson("/api/sessions", "POST", { ticket: "RIC-1" })).resolves.toEqual({ id: "a" });
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"ticket":"RIC-1"}');
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
  });
});

describe("apiBlob", () => {
  beforeEach(() => { setToken("tok"); });
  afterEach(() => { vi.unstubAllGlobals(); clearToken(); });

  it("sends the token and answers the bytes as a blob of their type", async () => {
    const f = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } }));
    vi.stubGlobal("fetch", f);
    const blob = await apiBlob("/api/sessions/x/image?path=a.png");
    expect(blob.type).toBe("image/png");
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([1, 2, 3]);
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(new Headers(init.headers).get("x-mojito-token")).toBe("tok");
  });

  it("throws the server's error like apiFetch, a 401 clearing the token", async () => {
    respond(415, { error: "not an image" });
    await expect(apiBlob("/api/x")).rejects.toMatchObject({ status: 415, message: "not an image" });
    respond(401, { error: "unauthorized" });
    await expect(apiBlob("/api/x")).rejects.toMatchObject({ status: 401 });
    expect(getToken()).toBe("");
  });
});
