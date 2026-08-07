import type { HookEventName, SessionMeta } from "./types.js";
import type { Registry } from "./registry.js";
import type { EventBus } from "./events.js";
import type { SessionResult } from "./sessionResult.js";
import { mapHook, mapCustomHook } from "./hookMap.js";

export interface HookDeps {
  registry: Registry;
  bus: EventBus;
  readResult: (id: string) => SessionResult | null;
  moveToQa: (ticket: string) => Promise<void>;
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

  if (meta.kind === "custom" || meta.kind === "rebase" || meta.kind === "shell") {
    // Shell sessions fire no hooks, so this branch is unreachable for them today; guarding here
    // future-proofs against any stray/manual hook pushing a plain terminal into the lime path.
    // Custom sessions have no ticket and no lifecycle; a rebase session has a real ticket
    // but no forward lifecycle (it stays at To QA or escalates backward to To Code, neither
    // of which we auto-advance on). Neither kind calls Linear or auto-advances, and
    // SessionEnd is a clean close (done), not a failure. A custom session is interactive
    // (mapCustomHook: rests at "idle" between turns); a rebase session is automated, so a
    // Stop that isn't a stage handoff is a genuine "waiting for you" (mapHook, needs-input).
    const outcome = meta.kind === "custom"
      ? mapCustomHook(event, meta.state)
      : event === "SessionEnd"
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

  let ready = false;
  if ((event === "Stop" || event === "SessionEnd") && meta.state !== "done") {
    const result = deps.readResult(id);
    if (result?.outcome === "ready-for-qa") {
      try {
        await deps.moveToQa(meta.ticket);
        ready = true;
      } catch {
        ready = false; // Linear write failed: Stop => needs-input so the user can retry
      }
    }
  }

  const outcome = mapHook(event, ready, meta.state);
  deps.registry.patch(id, { state: outcome.state, message: outcome.alert?.message });
  deps.bus.emit({ type: "session.state", id, state: outcome.state });
  if (outcome.alert) {
    deps.bus.emit({ type: "session.alert", id, kind: outcome.alert.kind, ticket: meta.ticket, message: outcome.alert.message });
  }
}
