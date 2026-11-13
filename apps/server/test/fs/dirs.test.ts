import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listDirs } from "../../src/fs/dirs";

const home = "/home/me";
const asRoot = process.getuid?.() === 0;
let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "mojito-dirs-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

async function names(path: string): Promise<string[]> {
  const res = await listDirs(path, home);
  if (!res.ok) throw new Error(res.reason);
  return res.list.dirs.map((d) => d.name);
}

describe("listDirs", () => {
  it("lists subfolders sorted case-insensitively, hidden ones and files left out", async () => {
    for (const d of ["b", "A", "c", ".hidden"]) mkdirSync(join(tmp, d));
    writeFileSync(join(tmp, "file.txt"), "x");
    const res = await listDirs(tmp, home);
    expect(res).toEqual({
      ok: true,
      list: {
        path: tmp,
        parent: dirname(tmp),
        home,
        dirs: [
          { name: "A", git: false },
          { name: "b", git: false },
          { name: "c", git: false },
        ],
      },
    });
  });

  it("marks a folder holding .git, directory or file", async () => {
    mkdirSync(join(tmp, "repo", ".git"), { recursive: true });
    mkdirSync(join(tmp, "wt"));
    writeFileSync(join(tmp, "wt", ".git"), "gitdir: /elsewhere\n");
    mkdirSync(join(tmp, "plain"));
    const res = await listDirs(tmp, home);
    expect(res.ok && res.list.dirs).toEqual([
      { name: "plain", git: false },
      { name: "repo", git: true },
      { name: "wt", git: true },
    ]);
  });

  it("follows a symlink to a folder, skips a broken one", async () => {
    mkdirSync(join(tmp, "repo", ".git"), { recursive: true });
    symlinkSync(join(tmp, "repo"), join(tmp, "link"));
    symlinkSync(join(tmp, "missing"), join(tmp, "dead"));
    const res = await listDirs(tmp, home);
    expect(res.ok && res.list.dirs).toEqual([
      { name: "link", git: true },
      { name: "repo", git: true },
    ]);
  });

  it("answers not-found for a missing path and for a file", async () => {
    writeFileSync(join(tmp, "file.txt"), "x");
    expect(await listDirs(join(tmp, "nope"), home)).toEqual({ ok: false, reason: "not-found" });
    expect(await listDirs(join(tmp, "file.txt"), home)).toEqual({ ok: false, reason: "not-found" });
  });

  it.skipIf(asRoot)("answers forbidden for an unreadable folder", async () => {
    const locked = join(tmp, "locked");
    mkdirSync(locked);
    chmodSync(locked, 0o000);
    try {
      expect(await listDirs(locked, home)).toEqual({ ok: false, reason: "forbidden" });
    } finally {
      chmodSync(locked, 0o700);
    }
  });

  it.skipIf(asRoot)("skips an unreadable child without failing the list", async () => {
    const locked = join(tmp, "locked");
    mkdirSync(locked);
    chmodSync(locked, 0o000);
    try {
      expect(await names(tmp)).toEqual(["locked"]);
    } finally {
      chmodSync(locked, 0o700);
    }
  });

  it("gives the root no parent", async () => {
    const res = await listDirs("/", home);
    expect(res.ok && res.list.parent).toBeNull();
    expect(res.ok && res.list.path).toBe("/");
  });
});
