import type { WebSocket, WebSocketServer } from "ws";

// A WebSocket severed by an idle NAT/Tailscale timeout, a sleeping laptop, or a
// backgrounded mobile browser emits no close event — the socket goes half-open
// and the terminal freezes with readyState still OPEN, so the client's reconnect
// never fires. `ws` does not detect this on its own; the documented remedy is a
// ping/pong heartbeat: ping every client on a fixed interval and terminate any
// that missed the previous ping. The ping traffic also keeps otherwise-idle
// connections alive through NAT/proxy idle timeouts.

// `ws` sockets carry no typed slot for our liveness flag; widen locally.
type Tracked = WebSocket & { isAlive?: boolean };

/** Mark a freshly-accepted socket alive and keep it alive on every pong. */
export function markAlive(ws: WebSocket): void {
  (ws as Tracked).isAlive = true;
  ws.on("pong", () => {
    (ws as Tracked).isAlive = true;
  });
}

/**
 * Start pinging every client of `wss` on `intervalMs`, terminating any that did
 * not pong since the previous tick. Returns a stop function that halts the loop.
 */
export function startHeartbeat(
  wss: Pick<WebSocketServer, "clients">,
  intervalMs = 30_000,
): () => void {
  const timer = setInterval(() => {
    for (const ws of wss.clients) {
      const tracked = ws as Tracked;
      if (tracked.isAlive === false) {
        tracked.terminate();
        continue;
      }
      tracked.isAlive = false;
      tracked.ping();
    }
  }, intervalMs);
  // A missed heartbeat must never keep the process alive on its own. Cast around
  // the DOM-vs-Node ambiguity in setInterval's return type.
  (timer as unknown as { unref?: () => void }).unref?.();
  return () => clearInterval(timer);
}
