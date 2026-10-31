import type { SessionsRepo } from "../db/sessions";
import type { EventBus } from "../events/bus";

/** How often the pane titles are read: one tmux call for every session. */
export const TITLE_POLL_MS = 5000;
const MAX_TITLE = 120;

// claude sets the terminal title to its status glyph (✳ idle, a braille spinner at work), a
// space and the session's name. A shell's title (the hostname, `user@host: ~`) starts with a
// letter, so it never reads as a name.
const CLAUDE_TITLE = /^[^\p{L}\p{N}\s]\s+(.+)$/u;
/** claude's title before the session has a name of its own. */
const UNNAMED = "Claude Code";

/** The session name in a pane title, or null when the title carries none. */
export function sessionTitle(paneTitle: string): string | null {
  const name = CLAUDE_TITLE.exec(paneTitle)?.[1]?.trim().slice(0, MAX_TITLE);
  return name && name !== UNNAMED ? name : null;
}

export interface TitleDeps {
  sessions: SessionsRepo;
  bus: EventBus;
  /** Pane title per tmux session name (`paneTitles(PREFIX)`). */
  paneTitles(): Promise<Map<string, string>>;
}

/**
 * Names each live session from its pane title. `/rename` fires no hook, but claude shows the
 * name in the terminal title, so tmux has it. A pane with no name keeps the last one (a gone
 * pane, a shell, claude before its first title), and only a change is broadcast.
 */
export async function refreshTitles(deps: TitleDeps): Promise<void> {
  const titles = await deps.paneTitles();
  for (const row of deps.sessions.list()) {
    if (row.state === "ended") continue;
    const title = sessionTitle(titles.get(row.id) ?? "");
    if (title === null || title === row.title) continue;
    const session = deps.sessions.patch(row.id, { title });
    if (session) deps.bus.emit({ type: "session.updated", session });
  }
}

/** Reads the titles every `TITLE_POLL_MS`, one round at a time; a failed round is logged and skipped. Returns the stop. */
export function startTitleWatch(deps: TitleDeps, intervalMs = TITLE_POLL_MS): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    refreshTitles(deps)
      .catch((err) => console.error("reading session titles failed", err))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  return () => clearInterval(timer);
}
