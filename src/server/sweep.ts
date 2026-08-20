import type { Registry } from "./registry";

export interface SweepDeps {
  registry: Registry;
  hasSession: (name: string) => Promise<boolean>;
}

/**
 * Remove orphaned sessions — those whose tmux session no longer exists (claude
 * exited, the machine restarted, or they were launched under a since-retired
 * status name). launchSession creates the tmux session before writing the
 * sidecar, so a registered session with no live tmux is genuinely dead, never an
 * in-flight launch. Returns the ids that were dropped.
 */
export async function sweepOrphans(deps: SweepDeps): Promise<string[]> {
  const removed: string[] = [];
  for (const meta of deps.registry.all()) {
    if (!(await deps.hasSession(meta.id))) {
      deps.registry.remove(meta.id); // also removes the sidecar
      removed.push(meta.id);
    }
  }
  return removed;
}
