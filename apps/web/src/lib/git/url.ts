// The git page keeps its state in the url: `ticket` picks the highlighted branch, `commit` opens
// the details sheet, `file` (+ `from` for a rename or copy) its diff. This is the one codec, so
// the page and every entry point agree.

import { isValidHash, isValidTicket } from "@mojito/shared";

export interface GitView {
  ticket: string | null;
  commit: string | null;
  file: string | null;
  from: string | null;
}

/** Only what makes sense survives: a file needs a commit, a `from` needs a file. */
export function parseGitSearch(params: URLSearchParams): GitView {
  const ticket = params.get("ticket");
  const commit = params.get("commit");
  const file = params.get("file");
  const from = params.get("from");
  const validCommit = commit !== null && isValidHash(commit) ? commit : null;
  const validFile = validCommit && file ? file : null;
  return {
    ticket: ticket !== null && isValidTicket(ticket) ? ticket : null,
    commit: validCommit,
    file: validFile,
    from: validFile && from ? from : null,
  };
}

export function gitHref(project: string, view: Partial<GitView> = {}): string {
  const params = new URLSearchParams();
  for (const key of ["ticket", "commit", "file", "from"] as const) {
    const value = view[key];
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return `/git/${encodeURIComponent(project)}${qs ? `?${qs}` : ""}`;
}
