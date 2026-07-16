import type { SessionMeta } from "@/server/types";

// Browser tab title for an open ticket terminal. `ticket`/`title` can be empty
// (custom sessions) or `title` undefined (sidecars from before the field existed),
// so both are trimmed and guarded.
export function terminalTabTitle(session: SessionMeta): string {
  const id = session.ticket?.trim();
  const title = session.title?.trim();
  if (id && title) return `${id} — ${title}`;
  if (id) return id;
  if (title) return title;
  return "Mojito";
}
