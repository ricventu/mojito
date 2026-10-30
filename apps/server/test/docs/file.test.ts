import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DOC_MAX_BYTES } from "@mojito/shared";
import { readDoc, resolveDocPath } from "../../src/docs/file";

let tmp: string;
let root: string;
let other: string;
let outside: string;

beforeAll(() => {
  // realpath: on some systems the temp dir itself sits behind a symlink.
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "mojito-docs-")));
  root = join(tmp, "repo");
  other = join(tmp, "wt");
  outside = join(tmp, "elsewhere");
  for (const dir of [join(root, "docs"), other, outside, join(tmp, "repo-old")]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(root, "docs", "a.md"), "# a\n");
  writeFileSync(join(other, "b.md"), "# b\n");
  writeFileSync(join(outside, "x.md"), "# x\n");
  writeFileSync(join(tmp, "repo-old", "a.md"), "# old\n");
  symlinkSync(join(outside, "x.md"), join(root, "out.md"));
  writeFileSync(join(root, ".env"), "SECRET=1\n");
  symlinkSync(join(root, ".env"), join(root, "docs", "evil.md"));
  mkdirSync(join(root, "d.md"));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("resolveDocPath", () => {
  const home = "/nowhere";

  it("resolves a relative path against the root", () => {
    expect(resolveDocPath("docs/a.md", root, [root], home)).toBe(join(root, "docs", "a.md"));
  });

  it("takes an absolute path inside any allowed root", () => {
    expect(resolveDocPath(join(other, "b.md"), root, [root, other], home)).toBe(join(other, "b.md"));
  });

  it("refuses an absolute path outside every allowed root", () => {
    expect(resolveDocPath(join(outside, "x.md"), root, [root, other], home)).toBeNull();
  });

  it("refuses a sibling whose name only starts with the root's", () => {
    expect(resolveDocPath(join(tmp, "repo-old", "a.md"), root, [root], home)).toBeNull();
  });

  it("expands ~/ to HOME, then treats it as absolute", () => {
    expect(resolveDocPath("~/b.md", root, [root, other], other)).toBe(join(other, "b.md"));
    expect(resolveDocPath("~/x.md", root, [root, other], outside)).toBeNull();
  });

  it("refuses a markdown name that is a symlink to a file that is not markdown, even inside the root", () => {
    expect(resolveDocPath("docs/evil.md", root, [root], home)).toBeNull();
  });

  it("refuses a symlink pointing out of the root", () => {
    expect(resolveDocPath("out.md", root, [root], home)).toBeNull();
  });

  it.each(["x.txt", "../x.md", "docs/../a.md", "a\0.md", ""])("refuses %j", (bad) => {
    expect(resolveDocPath(bad, root, [root], home)).toBeNull();
  });

  it("answers a missing file's path, for the read to call it not found", () => {
    expect(resolveDocPath("gone.md", root, [root], home)).toBe(join(root, "gone.md"));
  });
});

describe("readDoc", () => {
  it("reads a file as UTF-8", () => {
    expect(readDoc(join(root, "docs", "a.md"))).toEqual({ ok: true, content: "# a\n" });
  });

  it("calls a missing file or a directory not found", () => {
    expect(readDoc(join(root, "gone.md"))).toEqual({ ok: false, reason: "not-found" });
    expect(readDoc(join(root, "d.md"))).toEqual({ ok: false, reason: "not-found" });
  });

  it("refuses a file over the cap and takes one at it", () => {
    const big = join(tmp, "big.md");
    writeFileSync(big, "x".repeat(DOC_MAX_BYTES + 1));
    expect(readDoc(big)).toEqual({ ok: false, reason: "too-large" });
    writeFileSync(big, "x".repeat(DOC_MAX_BYTES));
    expect(readDoc(big)).toMatchObject({ ok: true });
  });
});
