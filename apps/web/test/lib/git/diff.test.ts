import { describe, expect, it } from "vitest";
import { diffLines } from "@/lib/git/diff";

describe("diffLines", () => {
  it("classifies each line", () => {
    const patch = ["@@ -1,3 +1,3 @@ fn", " keep", "-old", "+new", "\\ No newline at end of file"].join("\n");
    expect(diffLines(patch)).toEqual([
      { kind: "hunk", text: "@@ -1,3 +1,3 @@ fn" },
      { kind: "ctx", text: " keep" },
      { kind: "del", text: "-old" },
      { kind: "add", text: "+new" },
      { kind: "note", text: "\\ No newline at end of file" },
    ]);
  });

  it("gives a trailing newline no empty last line", () => {
    expect(diffLines("+a\n")).toEqual([{ kind: "add", text: "+a" }]);
  });

  it("keeps an empty line in the middle as context", () => {
    expect(diffLines("+a\n\n+b\n").map((l) => l.kind)).toEqual(["add", "ctx", "add"]);
  });

  it("answers an empty patch with no lines", () => {
    expect(diffLines("")).toEqual([]);
  });
});
