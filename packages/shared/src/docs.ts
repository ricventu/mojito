// The docs viewer (RIC-506): a project's markdown, read-only.

/** One markdown file: `path` relative to the root the list was read from, "/" separated. */
export interface DocEntry {
  path: string;
  /** Last modification, ISO 8601. */
  mtime: string;
  size: number;
}

/** Every document, newest first; `ticketDocs` are the ticket's own, paths from `docs` in its order. */
export interface DocList {
  docs: DocEntry[];
  ticketDocs: string[];
}

/** One document; `path` echoes the one asked for. */
export interface DocFile {
  path: string;
  content: string;
}

/** Larger documents are not served (real specs are well under 100 KB). */
export const DOC_MAX_BYTES = 512 * 1024;

/**
 * A path the docs routes may be asked for: non-empty, no NUL, no `..` segment, and a name with
 * a stem ending in `.md` (any case). Where it may point is the server's call.
 */
export function isDocPath(p: string): boolean {
  if (!p || p.includes("\0")) return false;
  const segments = p.split("/");
  if (segments.includes("..")) return false;
  const name = segments[segments.length - 1] ?? "";
  return name.length > 3 && name.toLowerCase().endsWith(".md");
}
