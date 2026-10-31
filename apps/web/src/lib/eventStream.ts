import { openEventStream as openShared, type EventSocket, type EventStreamHandlers, type Schedule } from "@mojito/shared";

export { EVENT_RETRY_MAX_MS, EVENT_RETRY_MS, retryDelay } from "@mojito/shared";
export type { EventSocket, EventStreamHandlers, Schedule } from "@mojito/shared";

const defaultSchedule: Schedule = (fn, ms) => {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
};

/** The shared `openEventStream` (`@mojito/shared`) on the browser's timers unless a test passes its own. */
export function openEventStream(
  connect: () => EventSocket,
  handlers: EventStreamHandlers,
  schedule: Schedule = defaultSchedule,
): () => void {
  return openShared(connect, handlers, schedule);
}
