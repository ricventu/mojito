import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { resolveDocPath, readDoc, DOC_MAX_BYTES, docEntry, scanSuperpowersDocs } from "@/server/docFiles";

let root: string;
let outside: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mojito-docs-"));
  outside = mkdtempSync(join(tmpdir(), "mojito-out-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

function write(rel: string, body: string, base = root): string {
  const abs = join(base, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, body);
  return abs;
}

describe("resolveDocPath", () => {
  it("resolves a markdown file inside the root", () => {
    const abs = write("docs/superpowers/specs/a-design.md", "# a");
    expect(resolveDocPath(root, "docs/superpowers/specs/a-design.md")).toBe(abs);
  });

  it("rejects traversal, absolute paths and empty input", () => {
    write("docs/a.md", "# a");
    expect(resolveDocPath(root, "../escape.md")).toBeNull();
    expect(resolveDocPath(root, "docs/../../escape.md")).toBeNull();
    expect(resolveDocPath(root, join(outside, "escape.md"))).toBeNull();
    expect(resolveDocPath(root, "")).toBeNull();
  });

  it("rejects anything that is not .md", () => {
    write("docs/secret.env", "TOKEN=1");
    expect(resolveDocPath(root, "docs/secret.env")).toBeNull();
    expect(resolveDocPath(root, "docs/a.md.txt")).toBeNull();
  });

  it("accepts an uppercase extension", () => {
    const abs = write("README.MD", "# r");
    expect(resolveDocPath(root, "README.MD")).toBe(abs);
  });

  it("rejects a symlink that escapes the root", () => {
    write("escape.md", "# secret", outside);
    symlinkSync(join(outside, "escape.md"), join(root, "link.md"));
    expect(resolveDocPath(root, "link.md")).toBeNull();
  });

  it("rejects a sibling directory whose name starts with the root's name", () => {
    // Verifies the separator check in inside(): naive startsWith() without sep would fail
    const parent = dirname(root);
    const rootBasename = basename(root);
    const evil = join(parent, rootBasename + "-evil");
    mkdirSync(evil);
    write("escape.md", "# secret", evil);
    symlinkSync(join(evil, "escape.md"), join(root, "link.md"));
    expect(resolveDocPath(root, "link.md")).toBeNull();
  });

  it("rejects a symlinked directory component that points outside the root", () => {
    mkdirSync(join(outside, "subdir"));
    write("file.md", "# content", join(outside, "subdir"));
    symlinkSync(join(outside, "subdir"), join(root, "symdir"));
    expect(resolveDocPath(root, "symdir/file.md")).toBeNull();
  });

  it("returns a path for a missing file, so the caller reports not-found", () => {
    expect(resolveDocPath(root, "docs/gone.md")).toBe(join(root, "docs/gone.md"));
  });
});

describe("readDoc", () => {
  it("reads the file as utf8", () => {
    const abs = write("a.md", "# heading\n");
    expect(readDoc(abs)).toEqual({ ok: true, content: "# heading\n" });
  });

  it("reports a missing file", () => {
    expect(readDoc(join(root, "gone.md"))).toEqual({ ok: false, reason: "not-found" });
  });

  it("reports a directory as not-found", () => {
    mkdirSync(join(root, "dir.md"));
    expect(readDoc(join(root, "dir.md"))).toEqual({ ok: false, reason: "not-found" });
  });

  it("refuses a file over the cap", () => {
    const abs = write("big.md", "x".repeat(40));
    expect(readDoc(abs, 10)).toEqual({ ok: false, reason: "too-large" });
    expect(DOC_MAX_BYTES).toBe(512 * 1024);
  });

  it("reads a file of exactly maxBytes", () => {
    const content = "x".repeat(100);
    const abs = write("exact.md", content);
    expect(readDoc(abs, 100)).toEqual({ ok: true, content });
  });
});

describe("scanSuperpowersDocs", () => {
  it("finds specs and plans at the root and one level down in a monorepo", () => {
    write("docs/superpowers/specs/root-design.md", "# root");
    write("docs/superpowers/plans/root-plan.md", "# plan");
    write("web/docs/superpowers/specs/nested-design.md", "# nested");
    const found = scanSuperpowersDocs(root);
    expect(found.map((d) => d.path).sort()).toEqual([
      "docs/superpowers/plans/root-plan.md",
      "docs/superpowers/specs/root-design.md",
      "web/docs/superpowers/specs/nested-design.md",
    ]);
    expect(found.find((d) => d.path.includes("plans"))!.source).toBe("plans");
    expect(found.find((d) => d.path.endsWith("root-design.md"))!.source).toBe("specs");
    expect(found.find((d) => d.path.endsWith("root-design.md"))!.name).toBe("root-design.md");
  });

  it("ignores non-markdown files and other folders under superpowers", () => {
    write("docs/superpowers/specs/a-design.md", "# a");
    write("docs/superpowers/specs/notes.txt", "x");
    write("docs/superpowers/journal/entry.md", "# j");
    expect(scanSuperpowersDocs(root).map((d) => d.path)).toEqual([
      "docs/superpowers/specs/a-design.md",
    ]);
  });

  it("does not descend into node_modules", () => {
    write("node_modules/pkg/docs/superpowers/specs/dep-design.md", "# dep");
    expect(scanSuperpowersDocs(root)).toEqual([]);
  });

  it("requires the parent directory to be named docs", () => {
    write("superpowers/specs/a-design.md", "# a");
    write("other/superpowers/specs/b-design.md", "# b");
    expect(scanSuperpowersDocs(root)).toEqual([]);
  });

  it("returns an empty list for a missing root", () => {
    expect(scanSuperpowersDocs(join(root, "nope"))).toEqual([]);
  });
});

describe("docEntry", () => {
  it("carries mtime and size", () => {
    write("docs/a.md", "hello");
    const entry = docEntry(root, "docs/a.md", "branch")!;
    expect(entry.size).toBe(5);
    expect(entry.source).toBe("branch");
    expect(Number.isNaN(Date.parse(entry.mtime))).toBe(false);
  });

  it("is null for a path that does not exist", () => {
    expect(docEntry(root, "docs/gone.md", "branch")).toBeNull();
  });
});
