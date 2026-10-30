import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GitError, readGit } from "../../src/git/git";
import { readDocFile } from "../../src/docs/file";
import { readDocList } from "../../src/docs/list";
import { docRoot } from "../../src/docs/root";

// Real git, in a temp dir, with the user's own git config out of the way.
const saved = { global: process.env.GIT_CONFIG_GLOBAL, nosystem: process.env.GIT_CONFIG_NOSYSTEM };
let tmp: string;
beforeAll(() => {
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "mojito-docs-git-")));
});
afterAll(() => {
  for (const [key, value] of [["GIT_CONFIG_GLOBAL", saved.global], ["GIT_CONFIG_NOSYSTEM", saved.nosystem]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(tmp, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function write(dir: string, file: string, text: string, mtime?: number): void {
  const path = join(dir, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  if (mtime !== undefined) utimesSync(path, mtime, mtime);
}

/** A repo on `main` with the given files committed. */
function repo(name: string, files: Record<string, string> = { "README.md": "# readme\n" }): string {
  const dir = join(tmp, name);
  mkdirSync(dir);
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.name", "Test");
  git(dir, "config", "user.email", "test@example.com");
  for (const [file, text] of Object.entries(files)) write(dir, file, text);
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  return dir;
}

/** `branch` off `main` with `files` committed on it, the checkout back on `main`. */
function branch(dir: string, name: string, files: Record<string, string>): void {
  git(dir, "switch", "-q", "-c", name);
  for (const [file, text] of Object.entries(files)) write(dir, file, text);
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", name);
  git(dir, "switch", "-q", "main");
}

const T = 1_790_000_000;

describe("readDocList: every document", () => {
  it("lists tracked and untracked markdown, newest first, leaving out ignored, deleted and nested checkouts", async () => {
    const dir = repo("list", {
      ".gitignore": "build/\n.wt/\n",
      "README.md": "# r\n",
      "docs/superpowers/specs/s.md": "# s\n",
      "old.md": "# old\n",
      "note.txt": "not markdown\n",
    });
    rmSync(join(dir, "old.md"));
    write(dir, "notes/u.md", "# u\n", T + 5);
    write(dir, "build/i.md", "# ignored\n");
    write(dir, "spec-perché.md", "# accent\n", T + 4);
    write(dir, "with space.md", "# space\n", T + 3);
    write(dir, "UPPER.MD", "# upper\n", T + 2);
    utimesSync(join(dir, "docs/superpowers/specs/s.md"), T + 1, T + 1);
    utimesSync(join(dir, "README.md"), T, T);
    git(dir, "worktree", "add", "-q", ".wt/x", "-b", "x");
    git(dir, "worktree", "add", "-q", "nest/y", "-b", "y");

    const list = await readDocList(dir, null, readGit);
    expect(list.docs.map((d) => d.path)).toEqual([
      "notes/u.md",
      "spec-perché.md",
      "with space.md",
      "UPPER.MD",
      "docs/superpowers/specs/s.md",
      "README.md",
    ]);
    expect(list.docs[0]).toEqual({ path: "notes/u.md", mtime: new Date((T + 5) * 1000).toISOString(), size: 4 });
    expect(list.ticketDocs).toEqual([]);
  });

  it("rejects with a GitError outside a repo", async () => {
    const plain = join(tmp, "plain");
    mkdirSync(plain);
    await expect(readDocList(plain, null, readGit)).rejects.toBeInstanceOf(GitError);
  });
});

describe("readDocList: a ticket's documents", () => {
  it("takes the id in the path or the body, as a whole token and in any case", async () => {
    const dir = repo("ticket", { "README.md": "# r\n", "docs/a.md": "Ticket: RIC-7\n" });
    write(dir, "docs/ric-7-plan.md", "# plan\n", T + 3);
    write(dir, "docs/b.md", "see ric-7 for more\n", T + 2);
    write(dir, "docs/c.md", "only RIC-70 here\n", T + 1);
    utimesSync(join(dir, "docs/a.md"), T, T);
    utimesSync(join(dir, "README.md"), T - 1, T - 1);

    const list = await readDocList(dir, "RIC-7", readGit);
    expect(list.ticketDocs).toEqual(["docs/ric-7-plan.md", "docs/b.md", "docs/a.md"]);
  });

  it("finds a body mention in a subdirectory project even when the repo asks grep for full names", async () => {
    const dir = repo("fullname", { "web/docs/a.md": "Ticket: RIC-30\n", "api/b.md": "RIC-30 too\n" });
    git(dir, "config", "grep.fullName", "true");
    const list = await readDocList(join(dir, "web"), "RIC-30", readGit);
    expect(list.ticketDocs).toEqual(["docs/a.md"]);
  });

  it("adds what the ticket's branch touched, once it is on disk in the root", async () => {
    const dir = repo("branchdiff");
    branch(dir, "ricventu/ric-8-x", { "docs/plain.md": "# no id in here\n" });

    const before = await readDocList(dir, "RIC-8", readGit);
    expect(before.docs.map((d) => d.path)).not.toContain("docs/plain.md");
    expect(before.ticketDocs).toEqual([]);

    const wt = join(tmp, "wt8");
    git(dir, "worktree", "add", "-q", wt, "ricventu/ric-8-x");
    expect((await docRoot(dir, "RIC-8", readGit)).root).toBe(wt);
    const after = await readDocList(dir, "RIC-8", readGit);
    expect(after.docs.map((d) => d.path)).toContain("docs/plain.md");
    expect(after.ticketDocs).toEqual(["docs/plain.md"]);
  });
});

describe("docRoot", () => {
  it("is the checkout without a ticket, or with one whose branch is not in another worktree", async () => {
    const dir = repo("roots");
    branch(dir, "ric-11", { "x.md": "x\n" });
    expect((await docRoot(dir, null, readGit)).root).toBe(dir);
    expect((await docRoot(dir, "RIC-11", readGit)).root).toBe(dir);
    expect((await docRoot(dir, "RIC-12", readGit)).root).toBe(dir);
  });

  it("keeps a subdirectory project's prefix in the ticket's worktree", async () => {
    const dir = repo("mono", { "web/docs/a.md": "# a\n", "api/b.md": "# b\n" });
    branch(dir, "ric-9", { "web/docs/n.md": "# n\n" });
    const wt = join(tmp, "wt9");
    git(dir, "worktree", "add", "-q", wt, "ric-9");

    expect((await docRoot(join(dir, "web"), "RIC-9", readGit)).root).toBe(join(wt, "web"));
    const list = await readDocList(join(dir, "web"), "RIC-9", readGit);
    expect(list.docs.map((d) => d.path).sort()).toEqual(["docs/a.md", "docs/n.md"]);
  });

  it("falls back to the checkout when the ticket's worktree is gone", async () => {
    const dir = repo("pruned");
    branch(dir, "ric-10", { "x.md": "x\n" });
    const wt = join(tmp, "wt10");
    git(dir, "worktree", "add", "-q", wt, "ric-10");
    rmSync(wt, { recursive: true, force: true });
    expect((await docRoot(dir, "RIC-10", readGit)).root).toBe(dir);
  });
});

describe("readDocFile", () => {
  let dir: string;
  let wt: string;
  beforeAll(() => {
    dir = repo("files", { "README.md": "# readme\n" });
    branch(dir, "ric-20", { "docs/spec.md": "# spec\n" });
    wt = join(tmp, "wt20");
    git(dir, "worktree", "add", "-q", wt, "ric-20");
    write(tmp, "unrelated/x.md", "# x\n");
  });

  it("reads a relative path in the ticket's root", async () => {
    expect(await readDocFile(dir, "docs/spec.md", "RIC-20", "/nowhere", readGit)).toEqual({
      ok: true,
      file: { path: "docs/spec.md", content: "# spec\n" },
    });
  });

  it("reads an absolute path inside another worktree of the repo, without a ticket", async () => {
    const path = join(wt, "docs/spec.md");
    expect(await readDocFile(dir, path, null, "/nowhere", readGit)).toEqual({ ok: true, file: { path, content: "# spec\n" } });
  });

  it("refuses an absolute path outside the repo's worktrees and a climbing path", async () => {
    expect(await readDocFile(dir, join(tmp, "unrelated/x.md"), null, "/nowhere", readGit)).toEqual({ ok: false, reason: "invalid" });
    expect(await readDocFile(dir, "../x.md", null, "/nowhere", readGit)).toEqual({ ok: false, reason: "invalid" });
  });

  it("calls a missing file not found", async () => {
    expect(await readDocFile(dir, "gone.md", null, "/nowhere", readGit)).toEqual({ ok: false, reason: "not-found" });
  });
});
