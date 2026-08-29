import { describe, expect, it } from "vitest";
import {
  filterSearch, formatLocation, NO_FILTERS, parseFilters, parseLocation, sessionUrl,
  type AppLocation,
} from "@/lib/appLocation";

const list = (filters: Partial<typeof NO_FILTERS> = {}): AppLocation => ({
  view: { kind: "list" },
  filters: { ...NO_FILTERS, ...filters },
});

describe("parseLocation", () => {
  it("reads a bare root as the unfiltered list", () => {
    expect(parseLocation("/", "")).toEqual(list());
  });

  // /stacks was its own view until RIC-253 folded that panel into the board's project
  // dividers; an old bookmark now lands on the list like any other unknown path.
  it("reads the retired stacks path as the list", () => {
    expect(parseLocation("/stacks", "")).toEqual(list());
  });

  it("reads every filter out of the query", () => {
    const { filters } = parseLocation("/", "?q=filtri&project=Mojito&status=In+Progress&mine=1&sessions=1");
    expect(filters).toEqual({
      query: "filtri", project: ["Mojito"], status: "In Progress", mine: true, sessionsOnly: true,
    });
  });

  it("reads a repeated project parameter as the whole selection, in url order", () => {
    expect(parseLocation("/", "?project=Mojito&project=Fornace").filters.project)
      .toEqual(["Mojito", "Fornace"]);
  });

  it("drops a duplicated project, so a hand-edited url cannot double an option", () => {
    expect(parseLocation("/", "?project=Mojito&project=Mojito").filters.project)
      .toEqual(["Mojito"]);
  });

  it("reads filters on a non-list path, so leaving the board cannot drop them", () => {
    expect(parseLocation("/session/s1", "?q=filtri").filters.query).toBe("filtri");
  });

  it("treats an empty project or status as unset, matching the activeFilters convention", () => {
    const { filters } = parseLocation("/", "?project=&status=");
    expect(filters.project).toEqual([]);
    expect(filters.status).toBeNull();
  });

  it("keeps the projects it can read when one of them is blank", () => {
    expect(parseLocation("/", "?project=Mojito&project=").filters.project).toEqual(["Mojito"]);
  });

  it("reads the toggles as on only for an explicit 1", () => {
    expect(parseLocation("/", "?mine=0&sessions=yes").filters).toEqual(NO_FILTERS);
  });

  it("reads a session path as a terminal with no docs overlay", () => {
    expect(parseLocation("/session/mojito-RIC-204-work", "").view)
      .toEqual({ kind: "session", id: "mojito-RIC-204-work", docs: null });
  });

  it("reads the terminal's docs overlay and its selected file", () => {
    expect(parseLocation("/session/mojito-RIC-204-work/docs", "?doc=plans%2Fp.md").view)
      .toEqual({ kind: "session", id: "mojito-RIC-204-work", docs: { doc: "plans/p.md" } });
  });

  it("reads an overlay with no file selected as the document list", () => {
    expect(parseLocation("/session/s1/docs", "").view)
      .toEqual({ kind: "session", id: "s1", docs: { doc: null } });
  });

  it("reads a ticket docs path with its project", () => {
    expect(parseLocation("/docs/ticket/RIC-204", "?docProject=Mojito").view)
      .toEqual({ kind: "docs", target: { ticket: "RIC-204", project: "Mojito" }, doc: null });
  });

  it("reads a ticket docs path with no project as an unscoped ticket", () => {
    expect(parseLocation("/docs/ticket/RIC-204", "").view)
      .toEqual({ kind: "docs", target: { ticket: "RIC-204", project: null }, doc: null });
  });

  it("keeps the docs target project separate from the project filter", () => {
    const { view, filters } = parseLocation("/docs/ticket/RIC-204", "?docProject=Mojito&project=Other");
    expect(view).toEqual({ kind: "docs", target: { ticket: "RIC-204", project: "Mojito" }, doc: null });
    expect(filters.project).toEqual(["Other"]);
  });

  it("reads a session docs path", () => {
    expect(parseLocation("/docs/session/s1", "?doc=specs%2Fd.md").view)
      .toEqual({ kind: "docs", target: { session: "s1" }, doc: "specs/d.md" });
  });

  it("decodes percent-escapes in path segments", () => {
    expect(parseLocation("/docs/ticket/RIC%2D204", "").view)
      .toEqual({ kind: "docs", target: { ticket: "RIC-204", project: null }, doc: null });
  });

  it("falls back to the list for a path it does not recognise", () => {
    for (const p of ["/sessions", "/session", "/docs", "/docs/ticket", "/docs/other/x", "/session/s1/other"]) {
      expect(parseLocation(p, "?q=kept").view, p).toEqual({ kind: "list" });
    }
  });
});

describe("formatLocation", () => {
  it("writes a clean board as a bare root, with no empty query", () => {
    expect(formatLocation(list())).toBe("/");
  });

  it("omits every filter sitting at its default", () => {
    expect(formatLocation(list({ mine: true }))).toBe("/?mine=1");
  });

  it("writes the filters in a stable order", () => {
    expect(formatLocation(list({
      query: "filtri", project: ["Mojito"], status: "In Progress", mine: true, sessionsOnly: true,
    }))).toBe("/?q=filtri&project=Mojito&status=In+Progress&mine=1&sessions=1");
  });

  it("writes one project parameter per selection, so a name may hold any separator", () => {
    expect(formatLocation(list({ project: ["Mojito", "A, B"] })))
      .toBe("/?project=Mojito&project=A%2C+B");
  });

  it("carries the filters onto other views", () => {
    expect(formatLocation({ view: { kind: "docs", target: { session: "s1" }, doc: null }, filters: { ...NO_FILTERS, query: "filtri" } }))
      .toBe("/docs/session/s1?q=filtri");
  });

  it("writes a terminal path", () => {
    expect(formatLocation({ view: { kind: "session", id: "s1", docs: null }, filters: NO_FILTERS }))
      .toBe("/session/s1");
  });

  it("writes the terminal's docs overlay and its selected file", () => {
    expect(formatLocation({
      view: { kind: "session", id: "s1", docs: { doc: "plans/p.md" } }, filters: NO_FILTERS,
    })).toBe("/session/s1/docs?doc=plans%2Fp.md");
  });

  it("writes a ticket docs path, project included only when there is one", () => {
    const view = { kind: "docs", target: { ticket: "RIC-204", project: "Mojito" }, doc: null } as const;
    expect(formatLocation({ view, filters: NO_FILTERS })).toBe("/docs/ticket/RIC-204?docProject=Mojito");
    expect(formatLocation({
      view: { ...view, target: { ticket: "RIC-204", project: null } }, filters: NO_FILTERS,
    })).toBe("/docs/ticket/RIC-204");
  });

  it("escapes path segments", () => {
    expect(formatLocation({ view: { kind: "session", id: "a/b c", docs: null }, filters: NO_FILTERS }))
      .toBe("/session/a%2Fb%20c");
  });
});

describe("round trip", () => {
  const cases: AppLocation[] = [
    list(),
    list({ query: "a&b=c", project: ["My Project"], status: "To QA", mine: true, sessionsOnly: true }),
    list({ project: ["Mojito", "A, B", "No project"] }),
    { view: { kind: "session", id: "mojito-RIC-204-work", docs: null }, filters: { ...NO_FILTERS, mine: true } },
    { view: { kind: "session", id: "s1", docs: { doc: null } }, filters: NO_FILTERS },
    { view: { kind: "session", id: "s1", docs: { doc: "plans/2026-08-18-x.md" } }, filters: NO_FILTERS },
    { view: { kind: "docs", target: { session: "s1" }, doc: "specs/d.md" }, filters: NO_FILTERS },
    { view: { kind: "docs", target: { ticket: "RIC-204", project: "Mojito" }, doc: null }, filters: NO_FILTERS },
    { view: { kind: "docs", target: { ticket: "RIC-204", project: null }, doc: "a.md" }, filters: NO_FILTERS },
  ];

  it("survives format then parse", () => {
    for (const loc of cases) {
      const url = formatLocation(loc);
      const [pathname, search] = url.split("?");
      expect(parseLocation(pathname, search ? `?${search}` : ""), url).toEqual(loc);
    }
  });
});

describe("sessionUrl", () => {
  it("is the bare terminal path, with no filters carried along", () => {
    expect(sessionUrl("mojito-RIC-224-work")).toBe("/session/mojito-RIC-224-work");
  });

  it("encodes the id, like every other path this module writes", () => {
    expect(sessionUrl("a/b c")).toBe("/session/a%2Fb%20c");
  });

  // It addresses a *new browser tab*, which has no history and no filter state of its
  // own: anything but a clean url would hand that tab a board narrowed by whatever the
  // opener happened to be filtering on.
  it("parses back to that session with the default filters", () => {
    expect(parseLocation(sessionUrl("s1"), "")).toEqual({
      view: { kind: "session", id: "s1", docs: null },
      filters: NO_FILTERS,
    });
  });
});

// The filter half of the codec on its own, so the address bar and the remembered
// filter set (see filterMemory) cannot drift into two formats.
describe("filterSearch / parseFilters", () => {
  it("writes the filters as the query the address bar would carry", () => {
    expect(filterSearch({ ...NO_FILTERS, project: ["Mojito"], status: "To QA" }))
      .toBe("project=Mojito&status=To+QA");
  });

  it("writes nothing at all for the unfiltered board", () => {
    expect(filterSearch(NO_FILTERS)).toBe("");
  });

  it("reads a query back, with or without its leading question mark", () => {
    const expected = { ...NO_FILTERS, query: "filtri", mine: true };
    expect(parseFilters("q=filtri&mine=1")).toEqual(expected);
    expect(parseFilters("?q=filtri&mine=1")).toEqual(expected);
  });

  it("reads an empty query as every filter at its default", () => {
    expect(parseFilters("")).toEqual(NO_FILTERS);
  });

  it("survives a round trip through the query", () => {
    const filters = {
      query: "a&b=c", project: ["Mojito", "A, B"], status: "In Progress",
      mine: true, sessionsOnly: true,
    };
    expect(parseFilters(filterSearch(filters))).toEqual(filters);
  });
});
