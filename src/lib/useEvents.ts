"use client";
import { useEffect } from "react";
import type { MojitoEvent } from "@/server/events";
import { openEventStream, type EventSocket } from "./eventStream";

/**
 * The live-update socket. `onEvent` fires per event; `onConnect` fires on every successful
 * (re)connection, including the first — see openEventStream, which owns the reconnect loop
 * and explains why resyncing on connect is what keeps the list honest. This half is the
 * glue: the url, and tying the stream's lifetime to the effect's.
 */
export function useEvents(token: string, onEvent: (e: MojitoEvent) => void, onConnect?: () => void) {
  useEffect(() => {
    if (!token) return;
    return openEventStream(
      () => {
        const proto = location.protocol === "https:" ? "wss" : "ws";
        const ws = new WebSocket(`${proto}://${location.host}/ws/events?token=${encodeURIComponent(token)}`);
        // A real WebSocket declares its handlers as `(this: WebSocket, ev: Event) => any`,
        // which under strictFunctionTypes is assignable to no narrower parameter type — and
        // narrower is the whole point of EventSocket, which exists so the reconnect logic can
        // be driven by a fake in the node-only test setup. Nothing here reads an event object,
        // so the cast gives up nothing.
        return ws as unknown as EventSocket;
      },
      { onEvent, onConnect },
    );
  }, [token, onEvent, onConnect]);
}
