import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { SESSION_GONE_CODE } from "@mojito/shared";
import type { WebSocket, WebSocketServer } from "ws";
import type { SessionsRepo } from "../db/sessions";
import type { EventBus } from "../events/bus";
import type { PeerRegistry } from "../peers/registry";
import { markEnded } from "../sessions/reconcile";
import { PREFIX } from "../tmux/tmux";
import { tokenMatches } from "../token";
import { attachEvents } from "./events";
import { markAlive } from "./heartbeat";
import { dialPeer, peerPtyUrl, relayPeerPty } from "./peerPty";
import { attachPty } from "./pty";

export interface UpgradeDeps {
  token: string;
  wss: WebSocketServer;
  sessions: SessionsRepo;
  bus: EventBus;
  now?(): number;
  /** Other instances, for `/ws/peers/<name>/pty/<id>`; without it that path is destroyed. */
  peers?: Pick<PeerRegistry, "config" | "online">;
  /** Opens the peer's gateway; replaced in tests. */
  dial?: (url: string) => Promise<WebSocket>;
}

const PTY_PATH = "/ws/pty/";
const PEER_PATH = "/ws/peers/";

// The peer name of a `/ws/peers/<name>/pty/…` path, decoded, and its session id: null when the id
// segment is empty, nested or will not decode (a bad id under a peer). Null for any other shape.
function peerPtyTarget(pathname: string): { name: string; id: string | null } | null {
  const parts = pathname.slice(PEER_PATH.length).split("/");
  if (parts.length < 3 || parts[1] !== "pty") return null;
  let name: string;
  try {
    name = decodeURIComponent(parts[0]);
  } catch {
    return null;
  }
  if (!name) return null;
  if (parts.length !== 3) return { name, id: null };
  try {
    return { name, id: decodeURIComponent(parts[2]) || null };
  } catch {
    return { name, id: null };
  }
}

// Gives up an upstream that was never handed to a browser. `ws` emits `error` on a protocol
// failure while closing, and an `error` nobody listens to is an uncaught exception.
function dropUpstream(upstream: WebSocket): void {
  upstream.on("error", () => {});
  upstream.close();
}

/**
 * A peer's terminal: dial the peer first, so a refusal can still be told to the browser, then
 * accept the browser's handshake and relay. An unreachable peer is answered (close 1011, which
 * the browser retries) rather than destroyed, like a gone session is.
 */
function relayToPeer(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  deps: UpgradeDeps,
  peer: { name: string; url: string },
  id: string,
): void {
  const refuse = () =>
    deps.wss.handleUpgrade(req, socket, head, (ws) => ws.close(1011, `${peer.name} is not reachable`));
  if (!deps.peers?.online(peer.name)) {
    refuse();
    return;
  }
  // The browser may give up while the dial is pending; its upstream must not be left open.
  // `end` (a clean hang-up) and `close` both count: the http server's sockets are half-open
  // capable, so a hang-up emits only `end` and the socket lingers until we destroy it. An
  // upgraded socket is not read until `ws` takes it over, and a socket nobody reads never
  // reports its peer's hang-up: resume it so a browser that leaves mid-dial is noticed. It sends
  // nothing before the 101, so no byte is dropped. `error` matters as much: node's http server
  // removes its own listener before `upgrade` and `ws` adds its own only in `handleUpgrade`, so
  // a reset during the dial would otherwise be an uncaught ECONNRESET that kills the process.
  let aborted = false;
  const abort = () => {
    aborted = true;
    socket.destroy();
  };
  const watch = ["end", "close", "error"] as const;
  for (const event of watch) socket.once(event, abort);
  // Handed to `ws` (which listens for itself) or given up on: stop watching.
  const unwatch = () => {
    for (const event of watch) socket.removeListener(event, abort);
  };
  socket.resume();
  const dial = deps.dial ?? dialPeer;
  dial(peerPtyUrl(peer.url, id, deps.token)).then(
    (upstream) => {
      if (aborted) {
        dropUpstream(upstream);
        socket.destroy();
        return;
      }
      unwatch();
      let relayed = false;
      try {
        deps.wss.handleUpgrade(req, socket, head, (ws) => {
          relayed = true;
          markAlive(ws);
          relayPeerPty(ws, upstream);
        });
        // `ws` answers a handshake it rejects (a bad key or version: 400) and destroys the socket
        // without calling back; with no `verifyClient` an accepted one runs the callback
        // synchronously. So no callback by now means the dialled upstream has no one to serve.
        if (!relayed) dropUpstream(upstream);
      } catch (err) {
        console.error("upgrade handler error:", err);
        dropUpstream(upstream);
        socket.destroy();
      }
    },
    (err) => {
      if (aborted) {
        socket.destroy();
        return;
      }
      unwatch();
      console.error(`peer ${peer.name}: terminal not opened:`, err instanceof Error ? err.message : err);
      try {
        refuse();
      } catch {
        socket.destroy();
      }
    },
  );
}

// The session id of a `/ws/pty/<id>` path; "" for a nested path or one that will not decode.
function ptySessionId(pathname: string): string {
  const raw = pathname.slice(PTY_PATH.length);
  if (raw.includes("/")) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return "";
  }
}

/**
 * The http server's `upgrade` listener. A WebSocket cannot carry a custom header from the
 * browser, so the token rides in the query (`?token=`). Three paths only: `/ws/events`,
 * `/ws/pty/<id>` for an `mj-` id, and `/ws/peers/<name>/pty/<id>`, the same terminal on a
 * configured peer, relayed (`peerPty.ts`) with the shared token — anything else, and any
 * failure at all, destroys the socket rather than answering it.
 *
 * Two refusals are answered rather than destroyed: an `mj-` id with no session row, and an id
 * that is no `mj-` id (or is empty, nested, undecodable) under a *configured* peer. The
 * handshake completes and the socket closes at once with `SESSION_GONE_CODE`. A destroyed
 * handshake reaches the browser as a bare 1006, which its reconnect loop retries every 1.5s
 * forever; 4404 is how it learns the session is gone and stops.
 */
export function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, deps: UpgradeDeps): void {
  try {
    const url = new URL(req.url ?? "", "http://localhost");
    if (!tokenMatches(url.searchParams.get("token"), deps.token)) {
      // Said, not just dropped: another Mojito instance dialling with a different token logs
      // "token rejected" instead of a bare hang-up. A browser sees no difference.
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      socket.destroy();
      return;
    }
    if (url.pathname === "/ws/events") {
      deps.wss.handleUpgrade(req, socket, head, (ws) => {
        markAlive(ws);
        attachEvents(ws, deps.bus);
      });
      return;
    }
    if (url.pathname.startsWith(PTY_PATH)) {
      // Never a tmux name for something that is not one of our sessions: the id goes to
      // `tmux attach-session -t`, and a target like `other:1` or a human's own session is
      // not ours to attach to.
      const id = ptySessionId(url.pathname);
      if (id.startsWith(PREFIX)) {
        if (!deps.sessions.get(id)) {
          deps.wss.handleUpgrade(req, socket, head, (ws) => ws.close(SESSION_GONE_CODE, "session gone"));
          return;
        }
        deps.wss.handleUpgrade(req, socket, head, (ws) => {
          markAlive(ws);
          // A row the gateway finds without a tmux (a crash, a kill from outside: no SessionEnd)
          // is ended here rather than left showing `running` until the next boot.
          attachPty(ws, id, { onGone: (gone) => markEnded(gone, { ...deps, now: deps.now ?? Date.now }) });
        });
        return;
      }
    }
    if (url.pathname.startsWith(PEER_PATH)) {
      const target = peerPtyTarget(url.pathname);
      const peer = target && deps.peers?.config(target.name);
      if (target && peer) {
        if (target.id?.startsWith(PREFIX)) {
          relayToPeer(req, socket, head, deps, peer, target.id);
        } else {
          // A known peer with an id that can never be a session: answered like a gone one, so the
          // browser stops instead of redialling every 1.5 s (an unknown peer stays destroyed).
          deps.wss.handleUpgrade(req, socket, head, (ws) => ws.close(SESSION_GONE_CODE, "session gone"));
        }
        return;
      }
    }
    socket.destroy();
  } catch (err) {
    console.error("upgrade handler error:", err);
    try {
      socket.destroy();
    } catch {
      /* already destroyed */
    }
  }
}
