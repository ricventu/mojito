import type { Registry } from "./registry.js";

export interface SupersedeDeps {
  closeSession: (name: string) => Promise<{ closed: boolean; forced: boolean }>;
  registry: Registry;
}

/**
 * Retire a session that has been replaced by a newer stage of the same ticket:
 * gracefully close its (now-idle) claude process and drop it from the registry
 * so a ticket keeps a single live session instead of accumulating one per status.
 */
export async function supersedeSession(prevId: string, deps: SupersedeDeps): Promise<void> {
  await deps.closeSession(prevId);
  deps.registry.remove(prevId); // also removes the sidecar
}
