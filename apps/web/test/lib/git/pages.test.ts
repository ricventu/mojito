import type { GitGraphPage, GraphCommit } from "@mojito/shared";
import { describe, expect, it } from "vitest";
import { pageCommits, refsOf } from "@/lib/git/pages";

const commit = (hash: string, subject = hash): GraphCommit => ({
  hash,
  parents: [],
  author: "a",
  date: "2026-10-30T00:00:00Z",
  subject,
  refs: [],
});
const page = (commits: GraphCommit[], hasMore = true): GitGraphPage => ({ head: null, highlight: null, commits, hasMore });

describe("pageCommits", () => {
  it("concatenates pages in order", () => {
    const pages = [page([commit("a"), commit("b")]), page([commit("c")], false)];
    expect(pageCommits(pages).map((c) => c.hash)).toEqual(["a", "b", "c"]);
  });

  // Two commits landed after page 1 was read: `--skip` now lands two rows earlier, so page 2
  // starts with the last two of page 1.
  it("drops the rows a later page repeats, keeping the first occurrence", () => {
    const pages = [
      page([commit("a"), commit("b"), commit("c", "first")]),
      page([commit("b", "repeat"), commit("c", "repeat"), commit("d"), commit("e")], false),
    ];
    const commits = pageCommits(pages);
    expect(commits.map((c) => c.hash)).toEqual(["a", "b", "c", "d", "e"]);
    expect(commits.find((c) => c.hash === "c")?.subject).toBe("first");
    expect(commits[1]).toBe(pages[0]!.commits[1]);
  });

  it("is empty for no pages", () => {
    expect(pageCommits([])).toEqual([]);
  });
});

describe("refsOf", () => {
  const tagged = (hash: string): GraphCommit => ({ ...commit(hash), refs: [{ name: hash, kind: "tag" }] });

  it("finds a loaded commit's refs by its full hash", () => {
    expect(refsOf([commit("aaaa111"), tagged("bbbb222")], "bbbb222")).toEqual([{ name: "bbbb222", kind: "tag" }]);
  });

  it("finds them by an abbreviation", () => {
    expect(refsOf([tagged("bbbb2223333")], "bbbb222")).toEqual([{ name: "bbbb2223333", kind: "tag" }]);
  });

  it("has none for a commit that is not loaded", () => {
    expect(refsOf([tagged("aaaa111")], "cccc333")).toEqual([]);
  });

  it("has none for an ambiguous abbreviation", () => {
    expect(refsOf([tagged("abcd1230"), tagged("abcd1231")], "abcd123")).toEqual([]);
  });
});
