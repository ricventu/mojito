import type { SessionMeta } from "./types.js";
import type { LaunchRequest } from "./launch.js";
import { defaultModelForStatus, defaultEffortForStatus } from "./stageDefaults.js";
import { getConfig, getRegistry } from "./app.js";
import { launchSession } from "./launch.js";
import { hasSession, newSession, pipePane, closeSession } from "./tmux.js";
import { supersedeSession } from "./supersede.js";

/**
 * Build the launch request for the next stage. Auto-advance is hands-off, so each stage runs
 * with ITS OWN default model and effort (see stageDefaults) rather than inheriting whatever the
 * user manually picked for the launching stage — a strong stage (e.g. To Review) must never be
 * downgraded to, or splurged on, the previous stage's model.
 */
export function buildAutoAdvanceRequest(prev: SessionMeta, newStatus: string): LaunchRequest {
  return {
    ticket: prev.ticket,
    status: newStatus,
    model: defaultModelForStatus(newStatus),
    effort: defaultEffortForStatus(newStatus),
    autoAdvance: prev.autoAdvance,
    projectName: prev.projectName ?? null,
    title: prev.title ?? "",
    labels: prev.labels ?? [],
    // Auto-advance runs headless (no Linear fetch on this path); this whole module is
    // removed in a later task once auto-advance itself is dropped.
    description: "",
  };
}

/**
 * Launch the next stage for a ticket at its per-status default model/effort. Best-effort.
 */
export async function runAutoAdvance(prev: SessionMeta, newStatus: string): Promise<void> {
  const cfg = getConfig();
  const registry = getRegistry();
  const res = await launchSession(
    buildAutoAdvanceRequest(prev, newStatus),
    { registry, stateDir: cfg.stateDir, port: cfg.port, token: cfg.token, projectsPath: cfg.projectsPath,
      hasSession, newSession, pipePane },
  );
  // Once the next stage is running, gracefully retire the predecessor so a ticket keeps one live
  // session instead of one per status it passed through.
  if (res.ok && res.meta.id !== prev.id) {
    await supersedeSession(prev.id, { closeSession, registry });
  }
}
