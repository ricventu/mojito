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
  // Reads Claude Code's auto-generated session title from a transcript file (see
  // sessionTitle.ts). Optional so tests that don't exercise titling can omit it.
  readTranscriptTitle?: (transcriptPath: string) => string | null;
}

export async function handleHook(
  id: string,
  event: HookEventName,
  deps: HookDeps,
  payload?: { sessionTitle?: string; transcriptPath?: string },
): Promise<void> {
  const meta = deps.registry.get(id);
  if (!meta) return;

  if (meta.kind === "custom" || meta.kind === "rebase") {
    // Custom sessions have no ticket and no lifecycle; a rebase session has a real ticket
    // but no forward lifecycle (it stays at To QA or escalates backward to To Code, neither
    // of which we auto-advance on). Neither kind calls Linear or auto-advances, and
    // SessionEnd is a clean close (done), not a failure.
    const outcome = event === "SessionEnd"
      ? { state: "done" as const, alert: null }
      : mapHook(event, false, meta.state);
    const patch: Partial<SessionMeta> = { state: outcome.state, message: outcome.alert?.message };
    // Label from Claude Code's session name. An explicit `session_title` (from --name /
    // /rename, delivered on SessionStart) wins; otherwise fall back to CC's auto-generated
    // title read from the transcript. Skip the transcript read on PostToolUse — it fires on
    // every tool call, and the title barely changes, so re-reading the transcript each time
    // would be pure overhead.
    const explicit = payload?.sessionTitle;
    let title: string | undefined = explicit && explicit.length > 0 ? explicit : undefined;
    if (!title && event !== "PostToolUse" && payload?.transcriptPath) {
      title = deps.readTranscriptTitle?.(payload.transcriptPath) ?? undefined;
    }
    if (typeof title === "string" && title.length > 0 && title !== meta.title) patch.title = title;
    deps.registry.patch(id, patch);
    deps.bus.emit({ type: "session.state", id, state: outcome.state });
    if (outcome.alert) {
      deps.bus.emit({ type: "session.alert", id, kind: outcome.alert.kind, ticket: meta.ticket, message: outcome.alert.message });
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

  const outcome = mapHook(event, statusAdvanced, meta.state);
  const updated = deps.registry.patch(id, { state: outcome.state, message: outcome.alert?.message });
  deps.bus.emit({ type: "session.state", id, state: outcome.state });
  if (outcome.alert) {
    deps.bus.emit({ type: "session.alert", id, kind: outcome.alert.kind, ticket: meta.ticket, message: outcome.alert.message });
  }

  // Auto-advance only on a genuine stage handoff (a fresh Stop/SessionEnd that moved the
  // ticket forward). statusAdvanced is set only for those events; a passive signal that
  // merely preserves an already-done state (e.g. an idle Notification, RIC-117) leaves it
  // false, so it can never relaunch a duplicate stage off the stale launchStatus.
  if (outcome.state === "done" && statusAdvanced && updated) {
    const decision = decideAutoAdvance(newStatus, updated.autoAdvance);
    if (decision.action === "launch") deps.onAutoAdvance(updated, newStatus);
  }
}
