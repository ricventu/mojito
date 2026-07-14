import type { HookEventName, SessionMeta } from "./types.js";
import type { Registry } from "./registry.js";
import type { EventBus } from "./events.js";
import { mapHook } from "./hookMap.js";
import { decideAutoAdvance, stageAdvanced } from "./autoAdvance.js";

export interface HookDeps {
  registry: Registry;
  bus: EventBus;
  getIssueStatus: (ticket: string) => Promise<string>;
  onAutoAdvance: (meta: SessionMeta, newStatus: string) => void;
}

export async function handleHook(
  id: string,
  event: HookEventName,
  deps: HookDeps,
  payload?: { sessionTitle?: string },
): Promise<void> {
  const meta = deps.registry.get(id);
  if (!meta) return;

  if (meta.kind === "custom") {
    // Custom sessions have no ticket or lifecycle: never call Linear, never auto-advance.
    // SessionEnd is a clean close (done), not a failure.
    const outcome = event === "SessionEnd"
      ? { state: "done" as const, alert: null }
      : mapHook(event, false);
    const patch: Partial<SessionMeta> = { state: outcome.state, message: outcome.alert?.message };
    const title = payload?.sessionTitle;
    if (typeof title === "string" && title.length > 0 && title !== meta.title) patch.title = title;
    deps.registry.patch(id, patch);
    deps.bus.emit({ type: "session.state", id, state: outcome.state });
    if (outcome.alert) {
      deps.bus.emit({ type: "session.alert", id, kind: outcome.alert.kind, ticket: "", message: outcome.alert.message });
    }
    return;
  }

  let statusAdvanced = false;
  let newStatus = meta.launchStatus;
  if (event === "Stop" || event === "SessionEnd") {
    try {
      newStatus = await deps.getIssueStatus(meta.ticket);
      // Advance only on a genuine stage handoff (a move to a later stage), not on a
      // same-stage or backward status change — otherwise a stray Stop hook could mark
      // the session done and launch a duplicate stage.
      statusAdvanced = stageAdvanced(meta.launchStatus, newStatus);
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
