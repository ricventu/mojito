import { useEffect, useSyncExternalStore } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { MojitoEvent, PeersAnswer, SessionMeta, TaskRecord } from "@mojito/shared";
import { entryScript, hasNewBuild } from "@/lib/appUpdate";
import { openEventStream, type EventSocket } from "@/lib/eventStream";
import { removeById, upsertById } from "@/lib/eventCache";
import { replacePeer } from "@/lib/peers";
import { favoritesMutationKey, qk } from "@/lib/queryKeys";
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
    case "settings.updated":
      // While favourites writes are queued, each one's own echo would refetch a list the
      // next write already supersedes; the queue re-reads the settings once it drains.
      if (qc.isMutating({ mutationKey: favoritesMutationKey }) === 0) {
        void qc.invalidateQueries({ queryKey: qk.settings });
      }
      break;
    case "tickets.changed":
      void qc.invalidateQueries({ queryKey: qk.tickets });
      break;
    case "projects.changed":
      void qc.invalidateQueries({ queryKey: qk.projects });
      break;
    case "peers.updated":
      qc.setQueryData<PeersAnswer>(qk.peers, (answer) => replacePeer(answer, e.peer));
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
 * Offers a reload when a deploy has replaced the running build. Never reloads by itself: that
 * would throw away a half-typed ticket. The toast does not stay, since on a phone it covers the
 * terminal's accessory bar; a missed one comes back at the next check.
 */
function checkForNewBuild(running: string | null): void {
  void hasNewBuild(running, () => fetch("/", { cache: "no-cache" })).then((isNew) => {
    if (!isNew) return;
    toast("New version available", {
      id: "new-build",
      duration: 15_000,
      action: { label: "Reload", onClick: () => window.location.reload() },
    });
  });
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
    const running = entryScript(document.documentElement.outerHTML);
    const dispose = openEventStream(() => dial(token), {
      onEvent: (e) => applyEvent(qc, e),
      onConnect: () => {
        for (const queryKey of Object.values(qk)) void qc.invalidateQueries({ queryKey });
        // A deploy restarts the server, so this is how a tab left open and visible hears of it.
        checkForNewBuild(running);
      },
    });
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void qc.invalidateQueries({ queryKey: qk.sessions });
      void qc.invalidateQueries({ queryKey: qk.tasks });
      checkForNewBuild(running);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      dispose();
    };
  }, [qc, token]);
}
