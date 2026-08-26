import type { MojitoEvent } from "@/server/events";

/** How long to wait before dialling again after the socket closes. */
export const EVENT_RETRY_MS = 2000;

/**
 * The bits of `WebSocket` this module touches. Narrow on purpose: it is what lets the
 * reconnect-and-resync logic below be tested against a fake socket in the node-only
 * vitest setup, the same way terminalRenderer.ts is tested against a fake terminal.
 */
export interface EventSocket {
  onopen: (() => void) | null;
  onmessage: ((m: { data: string }) => void) | null;
  onclose: (() => void) | null;
  close: () => void;
}

export interface EventStreamHandlers {
  onEvent: (e: MojitoEvent) => void;
  /**
   * Called on every successful connection, the first one included.
   *
   * This is not a convenience — it is the only thing that makes the session list
   * self-correcting. Events are fire-and-forget (see EventBus): they reach whoever is
   * connected right now, nothing is buffered and nothing replays, and `useSessions` has no
   * poll of its own. So every gap in this socket is a permanent gap in what the list
   * shows — the state changes that happened while it was down are simply never learned,
   * and the card sits at whatever it last saw. For a freshly launched session that is
   * "starting", forever (RIC-251).
   *
   * The New-ticket flow hit that on every use, which is why it was reported there: it
   * opens the session in a *new browser tab*, so the tab holding the board goes to the
   * background exactly as its intake session boots — and a backgrounded tab loses this
   * socket while SessionStart, PostToolUse and Stop all fire into nothing. A deploy
   * restart (`make prod`'s SIGUSR2 cycle) does the same to every open client.
   *
   * Reconnecting alone does not fix that; refetching on reconnect does.
   */
  onConnect?: () => void;
}

/** Schedules `fn` and answers the canceller for it — injected so tests need no clock. */
export type Schedule = (fn: () => void, ms: number) => () => void;

const defaultSchedule: Schedule = (fn, ms) => {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
};

/**
 * Keeps an event socket dialled, reconnecting after every close, and reports each
 * connection through `onConnect` so the caller can resync what it missed.
 *
 * Returns the disposer: it stops the retry loop *and* closes the live socket, so a
 * caller that disposes never reconnects afterwards (the React effect's cleanup runs on
 * every token change, and a stale loop would keep a second socket alive).
 */
export function openEventStream(
  connect: () => EventSocket,
  { onEvent, onConnect }: EventStreamHandlers,
  schedule: Schedule = defaultSchedule,
): () => void {
  let socket: EventSocket | null = null;
  let cancelRetry: (() => void) | null = null;
  let disposed = false;

  const dial = () => {
    socket = connect();
    socket.onopen = () => onConnect?.();
    socket.onmessage = (m) => onEvent(JSON.parse(m.data) as MojitoEvent);
    socket.onclose = () => {
      if (disposed) return;
      cancelRetry = schedule(dial, EVENT_RETRY_MS);
    };
  };
  dial();

  return () => {
    disposed = true;
    cancelRetry?.();
    socket?.close();
  };
}
