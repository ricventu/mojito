import type { HookEventName, SessionMeta } from "./types";
import type { Registry } from "./registry";
import type { EventBus } from "./events";
import type { SessionResult } from "./sessionResult";
import { mapHook, mapCustomHook } from "./hookMap";

export interface HookDeps {
  registry: Registry;
  bus: EventBus;
  readResult: (id: string) => SessionResult | null;
  moveToQa: (ticket: string) => Promise<void>;
  // "merged" — written only by the merge-fix session, which completed an already-approved
  // merge itself — closes the lifecycle: the ticket goes straight to Done.
  moveToDone: (ticket: string) => Promise<void>;
  // Clears the result file so a later Stop/SessionEnd on this same session (e.g. after the
  // user revives it with a prompt) never re-reads a stale result and re-fires the status
  // move. Called only on a SUCCESSFUL move — a failed write leaves the file in place
  // so the next Stop/SessionEnd can retry it.
  clearResult: (id: string) => void;
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

  if (meta.kind !== "ticket") {
    // Shell sessions fire no hooks, so that branch is unreachable for them today; guarding here
    // future-proofs against any stray/manual hook pushing a plain terminal into the ticket session path.
    // Custom and intake sessions have no ticket and no lifecycle: none of these kinds calls
    // Linear or moves to a new stage, and SessionEnd is a clean close (done), not a failure.
    // Both are interactive, so they rest at "idle" between turns (mapCustomHook) — an intake
    // session is a custom session wearing its purpose (RIC-251), and keying on "not a ticket
    // session" rather than naming the kinds is what keeps the next such kind from silently
    // falling into the lifecycle path below.
    const outcome = meta.kind === "shell"
      ? (event === "SessionEnd"
          ? { state: "done" as const, alert: null }
          : mapHook(event, false, meta.state))
      : mapCustomHook(event, meta.state);
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
  let merged = false;
  if ((event === "Stop" || event === "SessionEnd") && meta.state !== "done") {
    const result = deps.readResult(id);
    if (result?.outcome === "ready-for-qa" || result?.outcome === "merged") {
      try {
        if (result.outcome === "merged") await deps.moveToDone(meta.ticket);
        else await deps.moveToQa(meta.ticket);
        deps.clearResult(id); // success only: a stale file must never re-fire the move on a later Stop
        ready = true;
        merged = result.outcome === "merged";
      } catch {
        ready = false; // Linear write failed: Stop => needs-input so the user can retry
      }
    }
  }

  const outcome = mapHook(event, ready, meta.state);
  if (merged && outcome.alert) outcome.alert.message = "merged"; // mapHook's default copy says "ready for QA"
  deps.registry.patch(id, { state: outcome.state, message: outcome.alert?.message });
  deps.bus.emit({ type: "session.state", id, state: outcome.state });
  if (outcome.alert) {
    deps.bus.emit({ type: "session.alert", id, kind: outcome.alert.kind, ticket: meta.ticket, message: outcome.alert.message });
  }
}
