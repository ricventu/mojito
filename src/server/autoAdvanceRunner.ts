import type { SessionMeta } from "./types.js";
import { getConfig, getRegistry } from "./app.js";
import { launchSession } from "./launch.js";
import { hasSession, newSession, pipePane, closeSession } from "./tmux.js";
import { supersedeSession } from "./supersede.js";

/** Launch the next stage for a ticket, reusing its model/effort. Best-effort. */
export async function runAutoAdvance(prev: SessionMeta, newStatus: string): Promise<void> {
  const cfg = getConfig();
  const registry = getRegistry();
  const res = await launchSession(
    {
      ticket: prev.ticket,
      status: newStatus,
      model: prev.model,
      effort: prev.effort,
      autoAdvance: prev.autoAdvance,
      projectName: prev.projectName ?? null,
      title: prev.title ?? "",
      labels: prev.labels ?? [],
    },
    { registry, stateDir: cfg.stateDir, port: cfg.port, token: cfg.token, projectsPath: cfg.projectsPath,
      hasSession, newSession, pipePane },
  );
  // Once the next stage is running, gracefully retire the predecessor so a
  // ticket keeps one live session instead of one per status it passed through.
  if (res.ok && res.meta.id !== prev.id) {
    await supersedeSession(prev.id, { closeSession, registry });
  }
}
