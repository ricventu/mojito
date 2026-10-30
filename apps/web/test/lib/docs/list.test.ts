import { describe, expect, it } from "vitest";
import type { DocList } from "@mojito/shared";
import { docGroups, docLabel } from "@/lib/docs/list";

const entry = (path: string) => ({ path, mtime: "2026-10-30T10:00:00.000Z", size: 1 });
const list: DocList = {
  docs: [entry("CLAUDE.md"), entry("docs/specs/s.md"), entry("README.md"), entry("docs/plans/p.md")],
  ticketDocs: ["docs/specs/s.md", "docs/plans/p.md"],
};

describe("docGroups", () => {
  it("has no ticket group without a ticket", () => {
    expect(docGroups(list, null)).toEqual({ ticket: null, all: list.docs });
  });

  it("puts the ticket's documents in their own group, in the list's order, leaving all of them in the other", () => {
    expect(docGroups(list, "RIC-5")).toEqual({ ticket: [entry("docs/specs/s.md"), entry("docs/plans/p.md")], all: list.docs });
  });

  it("has an empty ticket group when the ticket has none", () => {
    expect(docGroups({ ...list, ticketDocs: [] }, "RIC-5").ticket).toEqual([]);
  });
});

describe("docLabel", () => {
  it("splits the name from its directory", () => {
    expect(docLabel("docs/superpowers/specs/a.md")).toEqual({ name: "a.md", dir: "docs/superpowers/specs" });
    expect(docLabel("/home/me/r/x.md")).toEqual({ name: "x.md", dir: "/home/me/r" });
  });

  it("has an empty directory at the root", () => {
    expect(docLabel("README.md")).toEqual({ name: "README.md", dir: "" });
  });
});
