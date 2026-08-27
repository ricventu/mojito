import { describe, expect, it } from "vitest";
import { knownProject, newTicketProject, soleProject } from "@/lib/sheetProject";
import { NO_FILTERS, type AppView, type ListFilters } from "@/lib/appLocation";
import type { SessionMeta } from "@/server/types";

// minimal SessionMeta factory — only projectName matters here
function session(projectName: string | null | undefined): SessionMeta {
  return {
    kind: "ticket",
    id: "mojito-RIC-1-work",
    ticket: "RIC-1",
    launchStatus: "In Progress",
    model: "opus",
    effort: "low",
    state: "running",
    cwd: "",
    createdAt: "2026-08-19T10:00:00.000Z",
    projectName,
    title: "Title",
    labels: [],
  } as SessionMeta;
}

const filters = (p: Partial<ListFilters> = {}): ListFilters => ({ ...NO_FILTERS, ...p });
const LIST: AppView = { kind: "list" };
const SESSION: AppView = { kind: "session", id: "mojito-RIC-1-work", docs: null };

describe("newTicketProject", () => {
  it("takes the open session's project, so a ticket opened from a terminal lands in that repo", () => {
    expect(newTicketProject(SESSION, filters(), session("Mojito"))).toBe("Mojito");
  });

  it("beats the project filter with the session's own project", () => {
    expect(newTicketProject(SESSION, filters({ project: ["Other"] }), session("Mojito"))).toBe("Mojito");
  });

  it("falls back to no project when the session carries none", () => {
    expect(newTicketProject(SESSION, filters({ project: ["Other"] }), session(null))).toBeNull();
    expect(newTicketProject(SESSION, filters(), session(undefined))).toBeNull();
    expect(newTicketProject(SESSION, filters(), session("  "))).toBeNull();
  });

  // The session list is polled: a terminal url whose session has not arrived yet
  // renders nothing, but the value must still be defined rather than throw.
  it("falls back to no project when the session is not loaded yet", () => {
    expect(newTicketProject(SESSION, filters({ project: ["Other"] }), null)).toBeNull();
  });

  it("takes the active project filter on the list", () => {
    expect(newTicketProject(LIST, filters({ project: ["Mojito"] }), null)).toBe("Mojito");
  });

  // The filter holds a set since RIC-225, and one field cannot honour two projects.
  it("is null when the board is filtered on several projects", () => {
    expect(newTicketProject(LIST, filters({ project: ["Mojito", "Fornace"] }), null)).toBeNull();
  });

  it("is null on an unfiltered list", () => {
    expect(newTicketProject(LIST, filters(), null)).toBeNull();
  });

  // Filters ride along on every path (see formatLocation), so the chip the user left
  // on the board still describes what they are looking at over in a doc.
  it("takes the project filter on the other non-session views too", () => {
    expect(newTicketProject(
      { kind: "docs", target: { ticket: "RIC-1", project: null }, doc: null },
      filters({ project: ["Mojito"] }),
      null,
    )).toBe("Mojito");
  });
});

describe("soleProject", () => {
  it("is the one selected project", () => {
    expect(soleProject(["Mojito"])).toBe("Mojito");
  });

  it("is null for none and for several, the two cases a single field cannot express", () => {
    expect(soleProject([])).toBeNull();
    expect(soleProject(["Mojito", "Fornace"])).toBeNull();
  });
});

describe("knownProject", () => {
  const projects = ["Mojito", "Fornace"];

  it("keeps a project the server actually offers", () => {
    expect(knownProject("Mojito", projects)).toBe("Mojito");
  });

  // A session can name a project that is no longer in projects.json; a select whose
  // value matches no option shows nothing and posts whatever it fell back to.
  it("drops a project that is not on the list", () => {
    expect(knownProject("Gone", projects)).toBeNull();
  });

  it("passes null through", () => {
    expect(knownProject(null, projects)).toBeNull();
  });

  // The list arrives from /api/projects one render late — the pre-selection must
  // survive that first empty pass rather than be resolved away against it.
  it("keeps the candidate while the project list is still empty", () => {
    expect(knownProject("Mojito", [])).toBe("Mojito");
  });
});
