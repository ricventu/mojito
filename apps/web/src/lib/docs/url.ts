// The docs page keeps its state in the url: `ticket` groups that ticket's documents on top (and
// picks its worktree, server side), `path` opens one document. This is the one codec, so the page,
// its links and every entry point agree.

import { isDocPath, isValidTicket } from "@mojito/shared";

export interface DocsView {
  ticket: string | null;
  path: string | null;
}

/** Only what makes sense survives: a bad ticket or a path that is no document is dropped. */
export function parseDocsSearch(params: URLSearchParams): DocsView {
  const ticket = params.get("ticket");
  const path = params.get("path");
  return {
    ticket: ticket !== null && isValidTicket(ticket) ? ticket : null,
    path: path !== null && isDocPath(path) ? path : null,
  };
}

/** A leading `./` is dropped: `./docs/a.md` and `docs/a.md` are one document, so one url. */
export function docsHref(project: string, view: Partial<DocsView> = {}): string {
  const params = new URLSearchParams();
  if (view.ticket) params.set("ticket", view.ticket);
  if (view.path) params.set("path", view.path.replace(/^(\.\/)+/, ""));
  const qs = params.toString();
  return `/docs/${encodeURIComponent(project)}${qs ? `?${qs}` : ""}`;
}
