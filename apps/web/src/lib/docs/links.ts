// What a link inside a rendered document does. http(s) leaves for a new tab, mailto opens the
// mail client, a relative markdown link opens that document in the viewer; everything else — a
// bare #anchor, another scheme, a link to a non-markdown file — renders as inert text.

import { isDocPath } from "@mojito/shared";

export type DocHref =
  | { kind: "external"; href: string }
  | { kind: "mail"; href: string }
  | { kind: "doc"; path: string }
  | { kind: "inert" };

const INERT: DocHref = { kind: "inert" };

/** `/` or `~/` in front of a path, "" for a relative one. */
const anchorOf = (path: string) => (path.startsWith("/") ? "/" : path.startsWith("~/") ? "~/" : "");

/**
 * `href` as found in the document at `docPath`. A relative link resolves against the document's
 * directory, `.` and `..` collapsed here (a relative root has no origin for `URL` to resolve
 * against); one climbing above the root is inert — the server would refuse it anyway.
 */
export function classifyHref(href: string | undefined, docPath: string): DocHref {
  if (!href) return INERT;
  if (/^https?:/i.test(href)) return { kind: "external", href };
  if (/^mailto:/i.test(href)) return { kind: "mail", href };
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return INERT;
  let target: string;
  try {
    target = decodeURIComponent(href.replace(/[?#].*$/, ""));
  } catch {
    return INERT;
  }
  if (!target) return INERT;

  const linkAnchor = anchorOf(target);
  const anchor = linkAnchor || anchorOf(docPath);
  const segments = linkAnchor ? [] : docPath.slice(anchor.length).split("/").slice(0, -1);
  for (const part of target.slice(linkAnchor.length).split("/")) {
    if (part === "" || part === ".") continue;
    if (part !== "..") segments.push(part);
    else if (segments.length > 0) segments.pop();
    else return INERT;
  }
  const path = anchor + segments.join("/");
  return isDocPath(path) ? { kind: "doc", path } : INERT;
}
