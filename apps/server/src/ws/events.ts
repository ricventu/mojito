import type { WebSocket } from "ws";
import type { EventBus } from "../events/bus";

/**
 * `/ws/events`: one JSON text frame per bus event, for as long as the socket is open. Nothing is
 * buffered or replayed — the client refetches everything on each (re)connection instead.
 */
export function attachEvents(ws: WebSocket, bus: EventBus): void {
  ws.on("error", (err) => {
    console.error("events ws error:", err);
    try {
      ws.close();
    } catch {
      /* already closed */
    }
  });

  const off = bus.subscribe((e) => {
    try {
      ws.send(JSON.stringify(e));
    } catch {
      /* closed */
    }
  });
  ws.on("close", off);
}
