import { describe, expect, it } from "vitest";
import {
  formatLocation, NO_FILTERS, parseLocation, type AppLocation,
} from "@/lib/appLocation";

const list = (filters: Partial<typeof NO_FILTERS> = {}): AppLocation => ({
  view: { kind: "list" },
  filters: { ...NO_FILTERS, ...filters },
});

describe("parseLocation", () => {
  it("reads a bare root as the unfiltered list", () => {
    expect(parseLocation("/", "")).toEqual(list());
  });

  it("reads the stacks path", () => {
    expect(parseLocation("/stacks", "")).toEqual({ view: { kind: "stacks" }, filters: NO_FILTERS });
  });

  it("reads every filter out of the query", () => {
    const { filters } = parseLocation("/", "?q=filtri&project=Mojito&status=In+Progress&mine=1&sessions=1");
    expect(filters).toEqual({
      query: "filtri", project: "Mojito", status: "In Progress", mine: true, sessionsOnly: true,
    });
  });

  it("reads filters on a non-list path, so switching tabs cannot drop them", () => {
    expect(parseLocation("/stacks", "?q=filtri").filters.query).toBe("filtri");
  });

  it("treats an empty project or status as unset, matching the activeFilters convention", () => {
    const { filters } = parseLocation("/", "?project=&status=");
    expect(filters.project).toBeNull();
    expect(filters.status).toBeNull();
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
    expect(filters.project).toBe("Other");
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
      query: "filtri", project: "Mojito", status: "In Progress", mine: true, sessionsOnly: true,
    }))).toBe("/?q=filtri&project=Mojito&status=In+Progress&mine=1&sessions=1");
  });

  it("carries the filters onto other views", () => {
    expect(formatLocation({ view: { kind: "stacks" }, filters: { ...NO_FILTERS, query: "filtri" } }))
      .toBe("/stacks?q=filtri");
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
    list({ query: "a&b=c", project: "My Project", status: "To QA", mine: true, sessionsOnly: true }),
    { view: { kind: "stacks" }, filters: { ...NO_FILTERS, status: "In Progress" } },
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
