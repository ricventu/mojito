import { describe, expect, it } from "vitest";
import { gitHref, parseGitSearch } from "@/lib/git/url";

const parse = (qs: string) => parseGitSearch(new URLSearchParams(qs));
const NONE = { ticket: null, commit: null, file: null, from: null };

describe("gitHref", () => {
  it("builds the project path with no view", () => {
    expect(gitHref("mojito")).toBe("/git/mojito");
  });

  it("encodes the project and the params, in a fixed order", () => {
    expect(gitHref("my proj", { file: "a b.txt", commit: "abc1234", ticket: "RIC-5" })).toBe(
      "/git/my%20proj?ticket=RIC-5&commit=abc1234&file=a+b.txt",
    );
  });

  it("omits null and undefined", () => {
    expect(gitHref("p", { ticket: null, commit: "abc1234", file: undefined })).toBe("/git/p?commit=abc1234");
  });

  it("writes from after file", () => {
    expect(gitHref("p", { commit: "abc1234", from: "old.ts", file: "new.ts" })).toBe(
      "/git/p?commit=abc1234&file=new.ts&from=old.ts",
    );
  });
});

describe("parseGitSearch", () => {
  it("round-trips a full view", () => {
    const view = { ticket: "RIC-5", commit: "abc1234", file: "a b/é.txt", from: "old name.txt" };
    const href = gitHref("my proj", view);
    expect(parseGitSearch(new URL(href, "http://x").searchParams)).toEqual(view);
  });

  it("reads nothing from an empty query", () => {
    expect(parse("")).toEqual(NONE);
  });

  it("drops a commit that is not a hash", () => {
    expect(parse("commit=HEAD&file=a.ts")).toEqual(NONE);
    expect(parse("commit=abc12")).toEqual(NONE);
    expect(parse("commit=ABC1234")).toEqual(NONE);
  });

  it("drops file and from without a commit", () => {
    expect(parse("file=a.ts&from=b.ts")).toEqual(NONE);
  });

  it("drops from without a file", () => {
    expect(parse("commit=abc1234&from=b.ts")).toEqual({ ...NONE, commit: "abc1234" });
  });

  it("drops an empty file", () => {
    expect(parse("commit=abc1234&file=")).toEqual({ ...NONE, commit: "abc1234" });
  });

  it("keeps a ticket only in its shape", () => {
    expect(parse("ticket=RIC-505").ticket).toBe("RIC-505");
    expect(parse("ticket=nope").ticket).toBeNull();
    expect(parse("ticket=RIC-5;rm").ticket).toBeNull();
  });
});
