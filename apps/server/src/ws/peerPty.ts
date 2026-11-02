/**
 * The terminal relay for a peer's session: browser → this instance `/ws/peers/<name>/pty/<id>`
 * → the peer's `/ws/pty/<id>`, authenticated with the shared `MOJITO_TOKEN`. Frames are piped
 * both ways untouched (binary stays binary, text stays text: see the protocol at the top of
 * `pty.ts`), so the peer's gateway is the only one that knows what a pty is.
 *
 * Closes travel too. The peer's `SESSION_GONE_CODE` (4404) must reach the browser intact, or its
 * reconnect loop would retry a session that is gone forever; any other code that is not ours to
 * forward (1005/1006 are never sent on the wire, 1001 is a peer going away) becomes 1011, which
 * the browser retries.
 */
import { WebSocket } from "ws";

/** Time allowed for the peer to accept the upgrade. */
const DIAL_TIMEOUT_MS = 10_000;
/** How often the peer link is pinged: a sleeping Mac sends no close. */
const PEER_PING_MS = 30_000;

/** The peer's gateway URL: `http→ws`, `https→wss`, id and token percent-encoded. */
export function peerPtyUrl(peerUrl: string, id: string, token: string): string {
  const base = peerUrl.replace(/^http/i, "ws").replace(/\/+$/, "");
  return `${base}/ws/pty/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`;
}

/** A close code that may be forwarded to the browser: 1000 and the application range 3000-4999. */
export function mirrorCode(code: number): number {
  return code === 1000 || (code >= 3000 && code <= 4999) ? code : 1011;
}

/**
 * Open the upstream socket. Rejects on a refused connection, a non-101 answer (a wrong token is
 * a 401) or no answer within `timeoutMs`, having terminated the socket so nothing dangles.
 */
export function dialPeer(url: string, timeoutMs = DIAL_TIMEOUT_MS): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const fail = (err: Error) => {
      clearTimeout(timer);
      // terminate() on a socket still connecting emits an `error`; keep a listener for it.
      ws.on("error", () => {});
      ws.terminate();
      reject(err);
    };
    const timer = setTimeout(() => fail(new Error(`no answer within ${timeoutMs} ms`)), timeoutMs);
    ws.once("open", () => {
      clearTimeout(timer);
      ws.removeAllListeners("error");
      ws.removeAllListeners("unexpected-response");
      resolve(ws);
    });
    ws.once("error", fail);
    ws.once("unexpected-response", (_req, res) => {
      res.resume();
      fail(new Error(`peer answered ${res.statusCode ?? "?"}`));
    });
  });
}

function safeClose(ws: WebSocket, code: number, reason: string): void {
  try {
    ws.close(code, reason);
  } catch {
    /* already closing */
  }
}

/** Pipe `browser` and `upstream` into one terminal; both are open. */
export function relayPeerPty(browser: WebSocket, upstream: WebSocket, opts: { pingMs?: number } = {}): void {
  const pipe = (from: WebSocket, to: WebSocket) => {
    from.on("message", (data, isBinary) => {
      if (to.readyState === WebSocket.OPEN) to.send(data, { binary: isBinary });
    });
  };
  pipe(browser, upstream);
  pipe(upstream, browser);

  // A peer that vanished without a close (a sleeping Mac, a dropped link) is found by a ping
  // that goes unanswered; the browser then learns 1011 and redials.
  let alive = true;
  upstream.on("pong", () => {
    alive = true;
  });
  const timer = setInterval(() => {
    if (!alive) {
      upstream.terminate();
      return;
    }
    alive = false;
    try {
      upstream.ping();
    } catch {
      /* closing */
    }
  }, opts.pingMs ?? PEER_PING_MS);
  (timer as unknown as { unref?: () => void }).unref?.();

  browser.on("close", () => {
    clearInterval(timer);
    safeClose(upstream, 1000, "");
  });
  upstream.on("close", (code) => {
    clearInterval(timer);
    safeClose(browser, mirrorCode(code), code === 1000 ? "" : "peer closed");
  });
  browser.on("error", (err) => {
    console.error("peer pty relay: browser socket error:", err);
    safeClose(upstream, 1011, "relay error");
  });
  upstream.on("error", (err) => {
    console.error("peer pty relay: peer socket error:", err);
    safeClose(browser, 1011, "peer error");
  });
}
