import type { LivePane } from "../tmux/tmux";
import type { EndWatch } from "./ends";
import { refreshTitles, type TitleDeps } from "./titles";

/** How often tmux is asked for the live panes: one call for every session. */
export const PANE_POLL_MS = 5000;

export interface PaneWatchDeps extends Omit<TitleDeps, "paneTitles"> {
  /** The live panes of Mojito's sessions (`livePanes(PREFIX)`). */
  livePanes(): Promise<Map<string, LivePane>>;
  ends: EndWatch;
}

/** One round: the session names from the pane titles (titles.ts), then the ends (ends.ts). */
export async function refreshPanes(deps: PaneWatchDeps): Promise<void> {
  const before = deps.sessions.list();
  const panes = await deps.livePanes();
  const titles = new Map([...panes].map(([id, pane]) => [id, pane.title]));
  await refreshTitles({ sessions: deps.sessions, bus: deps.bus, paneTitles: async () => titles });
  deps.ends.observe(panes, before);
}

/** Reads the panes every `PANE_POLL_MS`, one round at a time; a failed round is logged and skipped. Returns the stop. */
export function startPaneWatch(deps: PaneWatchDeps, intervalMs = PANE_POLL_MS): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    refreshPanes(deps)
      .catch((err) => console.error("reading the tmux panes failed", err))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  return () => clearInterval(timer);
}
