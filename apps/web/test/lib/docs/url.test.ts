import { describe, expect, it } from "vitest";
import { docsHref, parseDocsSearch } from "@/lib/docs/url";

const parse = (qs: string) => parseDocsSearch(new URLSearchParams(qs));

describe("docsHref", () => {
  it("encodes the project, even with a space", () => {
    expect(docsHref("Mojito v2")).toBe("/docs/Mojito%20v2");
  });

  it("adds the ticket and the path, dropping a leading ./", () => {
    expect(docsHref("Mojito v2", { ticket: "RIC-506", path: "./docs/a.md" })).toBe(
      "/docs/Mojito%20v2?ticket=RIC-506&path=docs%2Fa.md",
    );
  });

  it("writes host first", () => {
    expect(docsHref("p", { host: "mac", path: "./a.md" })).toBe("/docs/p?host=mac&path=a.md");
  });

  it("omits null and undefined", () => {
    expect(docsHref("p", { host: null, ticket: null, path: undefined })).toBe("/docs/p");
  });
});

describe("parseDocsSearch", () => {
  it("round-trips a host, a ticket and a path", () => {
    const view = { host: "mac", ticket: "RIC-5", path: "with space/perché.md" };
    const href = docsHref("p", view);
    expect(parse(href.split("?")[1]!)).toEqual(view);
  });

  it("drops a bad ticket and a path that is no document", () => {
    expect(parse("ticket=../x&path=x.txt")).toEqual({ host: null, ticket: null, path: null });
    expect(parse("path=../a.md")).toEqual({ host: null, ticket: null, path: null });
  });

  it("keeps a host as written", () => {
    expect(parse("host=mac")).toEqual({ host: "mac", ticket: null, path: null });
  });

  it("reads nothing as nothing", () => {
    expect(parse("")).toEqual({ host: null, ticket: null, path: null });
    expect(parse("host=")).toEqual({ host: null, ticket: null, path: null });
  });
});
