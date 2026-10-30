import { describe, expect, it } from "vitest";
import { classifyHref } from "@/lib/docs/links";

const SPEC = "docs/specs/a.md";

describe("classifyHref", () => {
  it("sends http(s) out", () => {
    expect(classifyHref("https://x.io/a", SPEC)).toEqual({ kind: "external", href: "https://x.io/a" });
    expect(classifyHref("HTTP://x.io", SPEC)).toEqual({ kind: "external", href: "HTTP://x.io" });
  });

  it("keeps mailto a plain link", () => {
    expect(classifyHref("mailto:a@b.io", SPEC)).toEqual({ kind: "mail", href: "mailto:a@b.io" });
  });

  it("opens relative markdown in the viewer, resolved against the document's directory", () => {
    expect(classifyHref("../plans/b.md#step-2", SPEC)).toEqual({ kind: "doc", path: "docs/plans/b.md" });
    expect(classifyHref("./c.md", SPEC)).toEqual({ kind: "doc", path: "docs/specs/c.md" });
    expect(classifyHref("c.MD", SPEC)).toEqual({ kind: "doc", path: "docs/specs/c.MD" });
    expect(classifyHref("../../README.md", SPEC)).toEqual({ kind: "doc", path: "README.md" });
    expect(classifyHref("with%20space.md", SPEC)).toEqual({ kind: "doc", path: "docs/specs/with space.md" });
  });

  it("keeps an absolute link absolute, and resolves against an absolute document", () => {
    expect(classifyHref("/abs/d.md", SPEC)).toEqual({ kind: "doc", path: "/abs/d.md" });
    expect(classifyHref("b.md", "/home/me/r/docs/a.md")).toEqual({ kind: "doc", path: "/home/me/r/docs/b.md" });
    expect(classifyHref("../b.md", "~/notes/a.md")).toEqual({ kind: "doc", path: "~/b.md" });
  });

  it("leaves inert a link that climbs above a relative root", () => {
    expect(classifyHref("../x.md", "a.md")).toEqual({ kind: "inert" });
    expect(classifyHref("../../../x.md", SPEC)).toEqual({ kind: "inert" });
  });

  it.each(["#top", "javascript:alert(1)", "data:text/html,x", "x.txt", "", undefined])("leaves %j inert", (href) => {
    expect(classifyHref(href, SPEC)).toEqual({ kind: "inert" });
  });
});
