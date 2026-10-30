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

  it("omits null and undefined", () => {
    expect(docsHref("p", { ticket: null, path: undefined })).toBe("/docs/p");
  });
});

describe("parseDocsSearch", () => {
  it("round-trips a ticket and a path", () => {
    const href = docsHref("p", { ticket: "RIC-5", path: "with space/perché.md" });
    expect(parse(href.split("?")[1]!)).toEqual({ ticket: "RIC-5", path: "with space/perché.md" });
  });

  it("drops a bad ticket and a path that is no document", () => {
    expect(parse("ticket=../x&path=x.txt")).toEqual({ ticket: null, path: null });
    expect(parse("path=../a.md")).toEqual({ ticket: null, path: null });
  });

  it("reads nothing as nothing", () => {
    expect(parse("")).toEqual({ ticket: null, path: null });
  });
});
