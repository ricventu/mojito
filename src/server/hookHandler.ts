import type { HookEventName, SessionMeta } from "./types.js";
import type { Registry } from "./registry.js";
import type { EventBus } from "./events.js";
import { mapHook } from "./hookMap.js";
import { decideAutoAdvance } from "./autoAdvance.js";

export interface HookDeps {
  registry: Registry;
  bus: EventBus;
  getIssueStatus: (ticket: string) => Promise<string>;
  onAutoAdvance: (meta: SessionMeta, newStatus: string) => void;
}

export async function handleHook(id: string, event: HookEventName, deps: HookDeps): Promise<void> {
  const meta = deps.registry.get(id);
  if (!meta) return;

  let statusAdvanced = false;
  let newStatus = meta.launchStatus;
  if (event === "Stop" || event === "SessionEnd") {
    try {
      newStatus = await deps.getIssueStatus(meta.ticket);
      statusAdvanced = newStatus !== meta.launchStatus;
    } catch {
      statusAdvanced = false; // fetch failure => treat as not advanced (Stop => needs-input, SessionEnd => failed)
    }
  }

  const outcome = mapHook(event, statusAdvanced);
  const updated = deps.registry.patch(id, { state: outcome.state, message: outcome.alert?.message });
  deps.bus.emit({ type: "session.state", id, state: outcome.state });
  if (outcome.alert) {
    deps.bus.emit({ type: "session.alert", id, kind: outcome.alert.kind, ticket: meta.ticket, message: outcome.alert.message });
  }

  if (outcome.state === "done" && updated) {
    const decision = decideAutoAdvance(newStatus, updated.autoAdvance);
    if (decision.action === "launch") deps.onAutoAdvance(updated, newStatus);
  }
}
