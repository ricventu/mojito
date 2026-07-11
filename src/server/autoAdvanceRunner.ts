import type { SessionMeta } from "./types.js";
import { getConfig, getRegistry } from "./app.js";
import { launchSession } from "./launch.js";
import { hasSession, newSession, pipePane } from "./tmux.js";

/** Launch the next stage for a ticket, reusing its model/effort. Best-effort. */
export async function runAutoAdvance(prev: SessionMeta, newStatus: string): Promise<void> {
  const cfg = getConfig();
  await launchSession(
    {
      ticket: prev.ticket,
      status: newStatus,
      model: prev.model,
      effort: prev.effort,
      autoAdvance: prev.autoAdvance,
      projectName: null, // repo already resolvable from the map/worktree
    },
    { registry: getRegistry(), stateDir: cfg.stateDir, port: cfg.port, token: cfg.token, projectsPath: cfg.projectsPath,
      hasSession, newSession, pipePane },
  );
}
