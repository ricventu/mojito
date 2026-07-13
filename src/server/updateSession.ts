import type { Registry } from "./registry.js";
import type { EventBus } from "./events.js";
import type { SessionMeta } from "./types.js";

export function updateAutoAdvance(
  id: string,
  autoAdvance: boolean,
  deps: { registry: Registry; bus: EventBus },
): SessionMeta | null {
  const next = deps.registry.patch(id, { autoAdvance });
  if (!next) return null;
  deps.bus.emit({ type: "session.state", id, state: next.state });
  return next;
}
