import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDocPath, readDoc, DOC_MAX_BYTES } from "@/server/docFiles";

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
});
