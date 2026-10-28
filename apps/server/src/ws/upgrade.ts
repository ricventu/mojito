import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { WebSocketServer } from "ws";
import type { SessionsRepo } from "../db/sessions";
import type { EventBus } from "../events/bus";
import { PREFIX } from "../tmux/tmux";
import { attachEvents } from "./events";
import { attachPty } from "./pty";

export interface UpgradeDeps {
  token: string;
  wss: WebSocketServer;
  sessions: SessionsRepo;
  bus: EventBus;
}

const PTY_PATH = "/ws/pty/";

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
 * browser, so the token rides in the query (`?token=`). Two paths only: `/ws/events`, and
 * `/ws/pty/<id>` for a session Mojito knows (an `mj-` id with a row) — anything else, and any
 * failure at all, destroys the socket rather than answering it.
 */
export function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, deps: UpgradeDeps): void {
  try {
    const url = new URL(req.url ?? "", "http://localhost");
    if (url.searchParams.get("token") !== deps.token) {
      socket.destroy();
      return;
    }
    if (url.pathname === "/ws/events") {
      deps.wss.handleUpgrade(req, socket, head, (ws) => attachEvents(ws, deps.bus));
      return;
    }
    if (url.pathname.startsWith(PTY_PATH)) {
      // Never a tmux name for something that is not one of our sessions: the id goes to
      // `tmux attach-session -t`, and a target like `other:1` or a human's own session is
      // not ours to attach to.
      const id = ptySessionId(url.pathname);
      if (id.startsWith(PREFIX) && deps.sessions.get(id)) {
        deps.wss.handleUpgrade(req, socket, head, (ws) => attachPty(ws, id));
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
