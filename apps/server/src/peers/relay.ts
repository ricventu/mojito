import type { PeerConfig } from "../config";

export const RELAY_TIMEOUT_MS = 30_000;

/**
 * What a client may ask a peer through this instance (`/api/peers/<name>/…`): the HTTP side of
 * opening a peer's session in place — kill, image upload and view, the git graph, the docs. A
 * `:slot` is one path segment; anything not listed is not relayed (settings, hooks, launch,
 * projects…: those are the peer's own client's).
 */
const ALLOWED: { method: string; pattern: string[] }[] = [
  { method: "DELETE", pattern: ["sessions", ":id"] },
  { method: "POST", pattern: ["sessions", ":id", "images"] },
  { method: "GET", pattern: ["sessions", ":id", "image"] },
  { method: "GET", pattern: ["projects", ":project", "git", "graph"] },
  { method: "GET", pattern: ["projects", ":project", "git", "commits", ":hash"] },
  { method: "GET", pattern: ["projects", ":project", "git", "commits", ":hash", "diff"] },
  { method: "GET", pattern: ["projects", ":project", "docs"] },
  { method: "GET", pattern: ["projects", ":project", "docs", "file"] },
];

/**
 * The peer path (`/api/…`) a request may be relayed to, or null. `segments` are the **raw** ones
 * after `/api/peers/<name>/`: each is decoded and must be one plain name — an empty, `.`/`..` or
 * `/`-carrying one (`..%2F..%2Fsettings`) is refused — and every param is encoded again, so it can
 * never reach another route on the peer. The query string is the caller's to pass verbatim, except
 * that a kill with `remove` (which also deletes the row) is not relayed.
 */
export function matchRelay(method: string, segments: string[], query: URLSearchParams): string | null {
  const decoded: string[] = [];
  for (const raw of segments) {
    let seg: string;
    try {
      seg = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (seg === "" || seg === "." || seg === ".." || seg.includes("/")) return null;
    decoded.push(seg);
  }
  for (const { method: m, pattern } of ALLOWED) {
    if (m !== method || pattern.length !== decoded.length) continue;
    if (!pattern.every((p, i) => (p.startsWith(":") ? true : p === decoded[i]))) continue;
    if (method === "DELETE" && query.has("remove")) return null;
    return "/api/" + decoded.map((seg, i) => (pattern[i].startsWith(":") ? encodeURIComponent(seg) : seg)).join("/");
  }
  return null;
}

/** The only response headers that come back: the ones that make a body safe to show and to cache. */
const PASSED_HEADERS = ["content-type", "content-length", "x-content-type-options", "content-security-policy", "cache-control"];

export type RelayRequest = {
  method: string;
  peerPath: string;
  /** `?a=b` or empty, as the client sent it. */
  search: string;
  contentType: string | null;
  body: ReadableStream<Uint8Array> | null;
};

/**
 * Replays a request on a peer with the shared token and nothing else of the browser's (no cookie,
 * no origin). Status and body come back untouched — the body is a stream, never read here, so image
 * bytes are not re-encoded — with only `PASSED_HEADERS`. Unreachable: 502; no answer within the
 * limit for its headers: 504 (the body, once the answer is in, may take as long as it takes). A peer error whose body is not json (a proxy's page) is a 502 too, so the client
 * always reads `{ error }` from a failure.
 */
export async function relayRequest(
  peer: PeerConfig,
  token: string,
  req: RelayRequest,
  opts: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<Response> {
  const headers: Record<string, string> = { "x-mojito-token": token };
  if (req.contentType) headers["content-type"] = req.contentType;
  // The limit is the peer's *answer* (its headers), not the transfer: the timer is cleared once
  // fetch resolves, so a slow upload or download is never cut mid-stream.
  const abort = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    abort.abort();
  }, opts.timeoutMs ?? RELAY_TIMEOUT_MS);
  let res: Response;
  try {
    res = await (opts.fetch ?? fetch)(`${peer.url}${req.peerPath}${req.search}`, {
      method: req.method,
      headers,
      signal: abort.signal,
      ...(req.body ? { body: req.body, duplex: "half" } : {}),
    } as RequestInit);
  } catch {
    return timedOut
      ? Response.json({ error: `${peer.name} did not answer within ${RELAY_TIMEOUT_MS / 1000} s` }, { status: 504 })
      : unreachable(peer);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok && !(res.headers.get("content-type") ?? "").includes("json")) {
    await res.body?.cancel().catch(() => {});
    return unreachable(peer);
  }
  const out = new Headers();
  for (const name of PASSED_HEADERS) {
    const value = res.headers.get(name);
    if (value !== null) out.set(name, value);
  }
  // fetch has already undone a content-encoding: the length on the wire is no longer the body's.
  if (res.headers.has("content-encoding")) out.delete("content-length");
  return new Response(res.body, { status: res.status, headers: out });
}

const unreachable = (peer: PeerConfig): Response => Response.json({ error: `${peer.name} is not reachable` }, { status: 502 });
