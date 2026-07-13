import type { WebSocket } from "ws";
import type { EventBus } from "./events.js";

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
