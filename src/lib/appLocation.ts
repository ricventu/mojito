import type { DocsTarget } from "./useDocs";

/**
 * The unified list's five filter values — the shape activeFilters reads, and the
 * one half of the app state this module serializes. `query` says "unset" with `""`
 * and `project` with `[]`, while `status` says it with `null`, because `""` is a
 * status name like any other.
 *
 * `project` is a set, not one name: the toolbar's project filter is a multi-select
 * (RIC-225), so "Mojito and Fornace, nothing else" is a state the url has to be able
 * to hold. Empty means every project, which is also what makes the clean board a
 * bare `/`.
 *
 * `backlog` is the one value here whose *default narrows* (RIC-275): a board nobody has
 * touched hides its Backlog tickets, so `false` is both the default and the restrictive
 * setting and the url parameter reads the other way round from every other one — absent
 * means hidden, `backlog=1` means shown. That is what keeps the default board a bare
 * `/`; the alternative, writing the restriction out, would have put a parameter in the
 * url of every untouched board. It also costs the invariant the rest of this file used
 * to rest on — "narrows the list" and "deviates from the default" being the same thing —
 * see filterMemory and activeFilters, which each say which of the two they now mean.
 */
export interface ListFilters {
  query: string;
  project: string[];
  status: string | null;
  mine: boolean;
  sessionsOnly: boolean;
  /** Whether Backlog tickets are shown. Off by default — see above. */
  backlog: boolean;
}

/**
 * Every filter at its default. The board the app opens on, not the whole board: the
 * Backlog is hidden here, which is the one default that narrows.
 */
export const NO_FILTERS: ListFilters = {
  query: "",
  project: [],
  status: null,
  mine: false,
  sessionsOnly: false,
  backlog: false,
};

/**
 * Which page the user is on. `session` keeps its docs overlay nested rather than
 * as a sibling boolean so "a file is selected but the overlay is closed" cannot
 * be expressed at all.
 */
export type AppView =
  | { kind: "list" }
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

/** The filter half of formatLocation, so filterSearch below shares its one format. */
function writeFilters(params: URLSearchParams, filters: ListFilters): void {
  if (filters.query !== "") params.set("q", filters.query);
  // One parameter per project rather than a joined list: a project name is free text
  // and could hold whatever separator was picked.
  for (const project of filters.project) params.append("project", project);
  if (filters.status !== null) params.set("status", filters.status);
  if (filters.mine) params.set("mine", "1");
  if (filters.sessionsOnly) params.set("sessions", "1");
  // Written when Backlog is *shown*, the opposite polarity to the two above: hidden is
  // the default, and a default is never written — see ListFilters.
  if (filters.backlog) params.set("backlog", "1");
}

/**
 * The filters alone, as the query string the address bar would carry them in — no
 * leading `?`, and `""` for the unfiltered board.
 *
 * Exported for filterMemory, which remembers the last filter set across app launches:
 * storing the url's own format rather than a second one of its own is what keeps the
 * two from drifting, and means a remembered set is read back by the same parser that
 * reads a hand-typed url.
 */
export function filterSearch(filters: ListFilters): string {
  const params = new URLSearchParams();
  writeFilters(params, filters);
  return params.toString();
}

/** The inverse of filterSearch. Total, and indifferent to a leading `?`. */
export function parseFilters(search: string): ListFilters {
  return readFilters(new URLSearchParams(search));
}

function readFilters(params: URLSearchParams): ListFilters {
  return {
    query: params.get("q") ?? "",
    project: selected(params, "project"),
    status: named(params, "status"),
    // `=== "1"` rather than a truthiness check, so an unrecognised value reads as
    // off — same rule the localStorage-backed toggles used before the URL owned them.
    mine: params.get("mine") === "1",
    sessionsOnly: params.get("sessions") === "1",
    backlog: params.get("backlog") === "1",
  };
}

function readView(pathname: string, params: URLSearchParams): AppView {
  const parts = segments(pathname);
  const doc = params.get("doc");
  if (parts.length === 0) return { kind: "list" };
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
  // Anything unrecognised is the list, so a stale bookmark or a hand-typed path —
  // /stacks, from before RIC-253 folded that panel into the board's project dividers —
  // lands somewhere real instead of on a blank page.
  return { kind: "list" };
}

/**
 * A repeated query value read as a set, in url order and without duplicates: the
 * multi-select project filter serializes as one `project=` parameter per selection,
 * so `?project=Mojito&project=Fornace` is the pair and no parameter at all is "every
 * project". Blanks are dropped for the same reason `named` drops them.
 */
function selected(params: URLSearchParams, key: string): string[] {
  return Array.from(new Set(params.getAll(key).filter((v) => v !== "")));
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
 * Filters are written on every path, not just the list's, so leaving the list for a
 * terminal or a doc and coming back does not silently drop them. Values sitting at
 * their default are omitted instead, which is what keeps the clean board a bare `/`.
 */
export function formatLocation({ view, filters }: AppLocation): string {
  const params = new URLSearchParams();
  writeFilters(params, filters);
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
