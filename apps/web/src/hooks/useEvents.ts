import { useEffect, useSyncExternalStore } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { MojitoEvent, SessionMeta, TaskRecord } from "@mojito/shared";
import { openEventStream, type EventSocket } from "@/lib/eventStream";
import { removeById, upsertById } from "@/lib/eventCache";
import { qk } from "@/lib/queryKeys";
import { getToken, subscribeToken } from "@/lib/token";

function applyEvent(qc: QueryClient, e: MojitoEvent) {
  switch (e.type) {
    case "session.updated":
      qc.setQueryData<SessionMeta[]>(qk.sessions, (list) => upsertById(list, e.session));
      break;
    case "session.removed":
      qc.setQueryData<SessionMeta[]>(qk.sessions, (list) => removeById(list, e.id));
      break;
    case "task.updated":
      qc.setQueryData<TaskRecord[]>(qk.tasks, (list) =>
        e.task.archived ? removeById(list, e.task.id) : upsertById(list, e.task),
      );
      break;
    case "tickets.changed":
      void qc.invalidateQueries({ queryKey: qk.tickets });
      break;
  }
}

function eventsUrl(token: string): string {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}/ws/events?token=${encodeURIComponent(token)}`;
}

/** The browser socket behind `EventSocket`'s narrower handler shapes. */
function dial(token: string): EventSocket {
  const ws = new WebSocket(eventsUrl(token));
  const socket: EventSocket = {
    onopen: null,
    onmessage: null,
    onclose: null,
    close: () => ws.close(),
  };
  ws.onopen = () => socket.onopen?.();
  ws.onmessage = (m) => socket.onmessage?.({ data: String(m.data) });
  ws.onclose = () => socket.onclose?.();
  return socket;
}

/**
 * Keeps the query cache live from `/ws/events`. Events are fire-and-forget, so every
 * (re)connection refetches everything, and coming back to a backgrounded tab refetches
 * sessions and tasks — a phone can leave the socket half-open with no close event.
 * Tickets are left out of the visibility refetch: a flapping tab must not become a
 * burst of Linear queries.
 */
export function useEvents(): void {
  const qc = useQueryClient();
  const token = useSyncExternalStore(subscribeToken, getToken);

  useEffect(() => {
    if (!token) return;
    const dispose = openEventStream(() => dial(token), {
      onEvent: (e) => applyEvent(qc, e),
      onConnect: () => {
        for (const queryKey of Object.values(qk)) void qc.invalidateQueries({ queryKey });
      },
    });
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void qc.invalidateQueries({ queryKey: qk.sessions });
      void qc.invalidateQueries({ queryKey: qk.tasks });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      dispose();
    };
  }, [qc, token]);
}
