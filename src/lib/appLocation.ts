import type { DocsTarget } from "./useDocs";

/**
 * The unified list's five filter values — the shape activeFilters reads, and the
 * one half of the app state this module serializes. `query` says "unset" with `""`,
 * while `project` and `status` say it with `null`, because `""` is a project name
 * like any other.
 */
export interface ListFilters {
  query: string;
  project: string | null;
  status: string | null;
  mine: boolean;
  sessionsOnly: boolean;
}

/** Every filter at its default: the whole board, nothing narrowed. */
export const NO_FILTERS: ListFilters = {
  query: "",
  project: null,
  status: null,
  mine: false,
  sessionsOnly: false,
};

/**
 * Which page the user is on. `session` keeps its docs overlay nested rather than
 * as a sibling boolean so "a file is selected but the overlay is closed" cannot
 * be expressed at all.
 */
export type AppView =
  | { kind: "list" }
  | { kind: "stacks" }
  | { kind: "session"; id: string; docs: { doc: string | null } | null }
  | { kind: "docs"; target: DocsTarget; doc: string | null };

/** The whole client state that lives in the address bar: the page, plus the filters. */
export interface AppLocation {
  view: AppView;
  filters: ListFilters;
}

/**
 * The docs target's project needs its own key: `project` is already the list's
 * project filter, and both hold a project name, so one key could not carry both.
 */
const DOC_PROJECT = "docProject";

function segments(pathname: string): string[] {
  return pathname.split("/").filter((s) => s !== "").map(decodeURIComponent);
}

function readFilters(params: URLSearchParams): ListFilters {
  return {
    query: params.get("q") ?? "",
    project: named(params, "project"),
    status: named(params, "status"),
    // `=== "1"` rather than a truthiness check, so an unrecognised value reads as
    // off — same rule the localStorage-backed toggles used before the URL owned them.
    mine: params.get("mine") === "1",
    sessionsOnly: params.get("sessions") === "1",
  };
}

function readView(pathname: string, params: URLSearchParams): AppView {
  const parts = segments(pathname);
  const doc = params.get("doc");
  if (parts.length === 0) return { kind: "list" };
  if (parts.length === 1 && parts[0] === "stacks") return { kind: "stacks" };
  if (parts[0] === "session" && parts.length === 2) {
    return { kind: "session", id: parts[1], docs: null };
  }
  if (parts[0] === "session" && parts.length === 3 && parts[2] === "docs") {
    return { kind: "session", id: parts[1], docs: { doc } };
  }
  if (parts[0] === "docs" && parts.length === 3) {
    if (parts[1] === "ticket") {
      return { kind: "docs", target: { ticket: parts[2], project: named(params, DOC_PROJECT) }, doc };
    }
    if (parts[1] === "session") return { kind: "docs", target: { session: parts[2] }, doc };
  }
  // Anything unrecognised is the list, so a stale bookmark or a hand-typed path
  // lands somewhere real instead of on a blank page.
  return { kind: "list" };
}

/** A `string | null` query value, where `""` reads as absent — see ListFilters. */
function named(params: URLSearchParams, key: string): string | null {
  const v = params.get(key);
  return v === null || v === "" ? null : v;
}

/** Read the address bar back into app state. Total: every input yields a location. */
export function parseLocation(pathname: string, search: string): AppLocation {
  const params = new URLSearchParams(search);
  return { view: readView(pathname, params), filters: readFilters(params) };
}

function viewPath(view: AppView): string {
  const enc = encodeURIComponent;
  switch (view.kind) {
    case "list": return "/";
    case "stacks": return "/stacks";
    case "session": return `/session/${enc(view.id)}${view.docs ? "/docs" : ""}`;
    case "docs":
      return "ticket" in view.target
        ? `/docs/ticket/${enc(view.target.ticket)}`
        : `/docs/session/${enc(view.target.session)}`;
  }
}

/**
 * The url for a location — the inverse of parseLocation.
 *
 * Filters are written on every path, not just the list's, so leaving the list for
 * the stacks panel and coming back does not silently drop them. Values sitting at
 * their default are omitted instead, which is what keeps the clean board a bare `/`.
 */
export function formatLocation({ view, filters }: AppLocation): string {
  const params = new URLSearchParams();
  if (filters.query !== "") params.set("q", filters.query);
  if (filters.project !== null) params.set("project", filters.project);
  if (filters.status !== null) params.set("status", filters.status);
  if (filters.mine) params.set("mine", "1");
  if (filters.sessionsOnly) params.set("sessions", "1");
  const doc = view.kind === "session" ? view.docs?.doc ?? null : view.kind === "docs" ? view.doc : null;
  if (doc !== null) params.set("doc", doc);
  if (view.kind === "docs" && "ticket" in view.target && view.target.project !== null) {
    params.set(DOC_PROJECT, view.target.project);
  }
  const query = params.toString();
  return query === "" ? viewPath(view) : `${viewPath(view)}?${query}`;
}

/**
 * The url of a session's terminal, clean of filters.
 *
 * For the one navigation that does not go through the history glue: opening a session
 * in a *new browser tab*, which starts with no location of its own, so the opener's
 * filters have no business travelling with it.
 */
export function sessionUrl(id: string): string {
  return formatLocation({ view: { kind: "session", id, docs: null }, filters: NO_FILTERS });
}
