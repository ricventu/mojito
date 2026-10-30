import type { DocEntry, DocList } from "@mojito/shared";

/** The ticket's own documents (null without a ticket) above every document; both keep the list's order. */
export function docGroups(list: DocList, ticket: string | null): { ticket: DocEntry[] | null; all: DocEntry[] } {
  if (!ticket) return { ticket: null, all: list.docs };
  const own = new Set(list.ticketDocs);
  return { ticket: list.docs.filter((d) => own.has(d.path)), all: list.docs };
}

/** A path's file name and the directory it sits in ("" at the root). */
export function docLabel(path: string): { name: string; dir: string } {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? { name: path, dir: "" } : { name: path.slice(cut + 1), dir: path.slice(0, cut) };
}
