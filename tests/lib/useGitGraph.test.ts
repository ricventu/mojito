import { describe, it, expect } from "vitest";
import { appendPage, commitErrorMessage, gitTargetQuery, graphErrorMessage } from "@/lib/useGitGraph";
import type { GraphPage } from "@/lib/gitGraph";

describe("gitTargetQuery", () => {
  it.each([
    [{ project: "Factory Book" }, "project=Factory+Book"],
    [{ session: "mojito-RIC-1-work" }, "session=mojito-RIC-1-work"],
    [{ ticket: "RIC-1", project: "Mojito" }, "ticket=RIC-1&project=Mojito"],
    [{ ticket: "RIC-1", project: null }, "ticket=RIC-1"],
  ])("builds %j", (target, q) => expect(gitTargetQuery(target)).toBe(q));
});

const commit = (hash: string) => ({ hash, parents: [], author: "", date: "", subject: hash, refs: [] });
const page = (hashes: string[], hasMore: boolean): GraphPage =>
  ({ label: "M", head: "h", highlight: null, commits: hashes.map(commit), hasMore });

describe("appendPage", () => {
  it("appends the next page and takes its hasMore", () => {
    const out = appendPage(page(["a", "b"], true), page(["c"], false));
    expect(out.commits.map((x) => x.hash)).toEqual(["a", "b", "c"]);
    expect(out.hasMore).toBe(false);
  });

  // A commit pushed between two pages shifts --skip by one, so the next page starts
  // with a commit already on screen.
  it("drops commits the previous pages already hold", () => {
    expect(appendPage(page(["a", "b"], true), page(["b", "c"], true)).commits.map((x) => x.hash))
      .toEqual(["a", "b", "c"]);
  });

  it("keeps the first page's head and highlight", () => {
    const first = { ...page(["a"], true), highlight: { branch: "x", tip: "a", base: "", baseTip: "", ahead: 0, behind: 0, merged: false } };
    expect(appendPage(first, page(["b"], false)).highlight?.branch).toBe("x");
  });
});

describe("graphErrorMessage", () => {
  it.each([
    [404, { session: "s" }, "This session no longer exists."],
    [404, { project: "M" }, "Unknown project."],
    [404, { ticket: "RIC-1", project: null }, "This ticket maps to no repo."],
  ] as const)("says what a %i means for %j", (status, target, text) => {
    expect(graphErrorMessage(status, target)).toBe(text);
  });

  it("shows git's own words for a 409", () => {
    expect(graphErrorMessage(409, { project: "M" }, "fatal: not a git repository")).toBe("fatal: not a git repository");
  });

  it("has a fallback", () => {
    expect(graphErrorMessage(500, { project: "M" })).toBe("Could not load the git graph.");
  });
});

describe("commitErrorMessage", () => {
  it("says a missing commit is missing", () => {
    expect(commitErrorMessage(404)).toBe("Commit not found.");
    expect(commitErrorMessage(500)).toBe("Could not load the commit.");
  });
});
