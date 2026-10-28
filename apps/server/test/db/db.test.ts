import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, migrate } from "../../src/db/db";
import { ProjectsRepo, importProjectsJson } from "../../src/db/projects";
import { SettingsRepo } from "../../src/db/settings";
import { SessionsRepo } from "../../src/db/sessions";
import { TasksRepo } from "../../src/db/tasks";
import type { SessionMeta, TaskRecord } from "@mojito/shared";

describe("migrate", () => {
  it("is idempotent and records the version once", () => {
    const db = openDb(":memory:");
    migrate(db);
    migrate(db);
    const rows = db.prepare("SELECT version FROM schema_migrations").all();
    expect(rows).toEqual([{ version: 1 }]);
  });
  it("enforces foreign keys pragma", () => {
    const db = openDb(":memory:");
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
  });
});

describe("ProjectsRepo", () => {
  it("upserts, lists sorted, gets, renames and removes", () => {
    const repo = new ProjectsRepo(openDb(":memory:"));
    expect(repo.isEmpty()).toBe(true);
    repo.upsert({ name: "Web", path: "/w", teamKey: "RIC" });
    repo.upsert({ name: "Api", path: "/a", teamKey: "RIC" });
    repo.upsert({ name: "Api", path: "/a2", teamKey: "RIC" });
    expect(repo.isEmpty()).toBe(false);
    expect(repo.list().map((p) => p.name)).toEqual(["Api", "Web"]);
    expect(repo.get("Api")).toEqual({ name: "Api", path: "/a2", teamKey: "RIC" });
    expect(repo.get("nope")).toBeNull();
    repo.rename("Api", { name: "Backend", path: "/b", teamKey: "RIC" });
    expect(repo.get("Api")).toBeNull();
    expect(repo.get("Backend")?.path).toBe("/b");
    repo.remove("Backend");
    expect(repo.list().map((p) => p.name)).toEqual(["Web"]);
  });
});

describe("importProjectsJson", () => {
  const write = (content: string) => {
    const f = join(mkdtempSync(join(tmpdir(), "mj-proj-")), "projects.json");
    writeFileSync(f, content);
    return f;
  };
  it("imports string, nested and path-only entries", () => {
    const repo = new ProjectsRepo(openDb(":memory:"));
    const f = write(
      JSON.stringify({
        RIC: { path: "/a", projects: { Web: "/w", Api: "/x" } },
        OPS: "/o",
        DOC: { path: "/d" },
      }),
    );
    expect(importProjectsJson(repo, f)).toBe(4);
    expect(repo.get("Web")).toEqual({ name: "Web", path: "/w", teamKey: "RIC" });
    expect(repo.get("Api")).toEqual({ name: "Api", path: "/x", teamKey: "RIC" });
    expect(repo.get("OPS")).toEqual({ name: "OPS", path: "/o", teamKey: "OPS" });
    expect(repo.get("DOC")).toEqual({ name: "DOC", path: "/d", teamKey: "DOC" });
  });
  it("returns 0 for a missing or malformed file", () => {
    const repo = new ProjectsRepo(openDb(":memory:"));
    expect(importProjectsJson(repo, "/nonexistent/projects.json")).toBe(0);
    expect(importProjectsJson(repo, write("{not json"))).toBe(0);
    expect(importProjectsJson(repo, write("null"))).toBe(0);
    expect(repo.isEmpty()).toBe(true);
  });
});

describe("SettingsRepo", () => {
  it("returns defaults on an empty db", () => {
    const s = new SettingsRepo(openDb(":memory:")).get();
    expect(s.brainstormingDefault).toBe(false);
    expect(Object.keys(s.statusDefaults)).toEqual(["Backlog", "Todo", "In Progress", "In Review"]);
    expect(s.statusDefaults["Todo"]).toEqual({ model: "opus", effort: "high" });
  });
  it("merges stored values over defaults per status", () => {
    const repo = new SettingsRepo(openDb(":memory:"));
    repo.set({ statusDefaults: { Todo: { model: "sonnet", effort: "low" } }, brainstormingDefault: true });
    const s = repo.get();
    expect(s.statusDefaults["Todo"]).toEqual({ model: "sonnet", effort: "low" });
    expect(s.statusDefaults["In Review"]).toEqual({ model: "opus", effort: "high" });
    expect(s.brainstormingDefault).toBe(true);
    repo.set({ statusDefaults: {}, brainstormingDefault: false });
    expect(repo.get().brainstormingDefault).toBe(false);
  });
});

const session = (over: Partial<SessionMeta> = {}): SessionMeta => ({
  id: "mj-RIC-1",
  kind: "ticket",
  project: "Web",
  ticket: "RIC-1",
  cwd: "/w",
  model: "opus",
  effort: "high",
  brainstorming: true,
  state: "starting",
  alert: null,
  createdAt: 1,
  lastEventAt: 1,
  ...over,
});

describe("SessionsRepo", () => {
  it("round-trips, including booleans and nulls", () => {
    const repo = new SessionsRepo(openDb(":memory:"));
    repo.insert(session());
    repo.insert(session({ id: "mj-shell-abc123", kind: "shell", ticket: null, project: null, model: null, effort: null, brainstorming: false }));
    expect(repo.get("mj-RIC-1")).toEqual(session());
    const shell = repo.get("mj-shell-abc123")!;
    expect(shell).toMatchObject({ ticket: null, project: null, model: null, effort: null, brainstorming: false });
    expect(repo.list()).toHaveLength(2);
    expect(repo.get("zzz")).toBeNull();
  });
  it("patch updates state/alert/lastEventAt and returns the row", () => {
    const repo = new SessionsRepo(openDb(":memory:"));
    repo.insert(session());
    const p = repo.patch("mj-RIC-1", { state: "needs-input", alert: "permesso", lastEventAt: 9 });
    expect(p).toMatchObject({ state: "needs-input", alert: "permesso", lastEventAt: 9 });
    expect(repo.patch("mj-RIC-1", { alert: null })?.alert).toBeNull();
    expect(repo.patch("mj-RIC-1", {})?.state).toBe("needs-input");
    expect(repo.patch("zzz", { state: "idle" })).toBeNull();
  });
  it("insert replaces an existing row with the same id", () => {
    const repo = new SessionsRepo(openDb(":memory:"));
    repo.insert(session({ state: "ended", createdAt: 1 }));
    repo.insert(session({ state: "starting", createdAt: 5 }));
    expect(repo.list()).toHaveLength(1);
    expect(repo.get("mj-RIC-1")).toMatchObject({ state: "starting", createdAt: 5 });
  });
  it("remove deletes the row", () => {
    const repo = new SessionsRepo(openDb(":memory:"));
    repo.insert(session());
    repo.remove("mj-RIC-1");
    expect(repo.get("mj-RIC-1")).toBeNull();
  });
  it("liveForTicket ignores ended sessions and other kinds", () => {
    const repo = new SessionsRepo(openDb(":memory:"));
    repo.insert(session({ state: "ended" }));
    expect(repo.liveForTicket("RIC-1")).toBeNull();
    repo.insert(session({ state: "running" }));
    expect(repo.liveForTicket("RIC-1")?.id).toBe("mj-RIC-1");
    expect(repo.liveForTicket("RIC-2")).toBeNull();
    repo.insert(session({ id: "mj-web-aaaaaa", kind: "claude", ticket: "RIC-3", state: "running" }));
    expect(repo.liveForTicket("RIC-3")).toBeNull();
  });
});

const task = (over: Partial<TaskRecord> = {}): TaskRecord => ({
  id: "t1",
  type: "create-ticket",
  input: { project: "Web", note: "nota", imageUrls: ["u1"] },
  status: "queued",
  log: [],
  error: null,
  result: null,
  archived: false,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

describe("TasksRepo", () => {
  it("round-trips JSON columns and booleans", () => {
    const repo = new TasksRepo(openDb(":memory:"));
    repo.insert(task());
    expect(repo.get("t1")).toEqual(task());
    expect(repo.get("zzz")).toBeNull();
    expect(repo.list()).toHaveLength(1);
  });
  it("update merges fields and returns the row", () => {
    const repo = new TasksRepo(openDb(":memory:"));
    repo.insert(task());
    const u = repo.update("t1", { status: "done", result: { identifier: "RIC-9", url: "http://x" }, archived: true, updatedAt: 7 });
    expect(u).toMatchObject({ status: "done", result: { identifier: "RIC-9", url: "http://x" }, archived: true, updatedAt: 7 });
    expect(repo.update("zzz", { status: "done" })).toBeNull();
  });
  it("appendLog appends lines in order", () => {
    const repo = new TasksRepo(openDb(":memory:"));
    repo.insert(task());
    repo.appendLog("t1", "uno");
    expect(repo.appendLog("t1", "due")?.log).toEqual(["uno", "due"]);
    expect(repo.appendLog("zzz", "x")).toBeNull();
  });
  it("failInterrupted only touches queued and running", () => {
    const repo = new TasksRepo(openDb(":memory:"));
    repo.insert(task({ id: "q", status: "queued" }));
    repo.insert(task({ id: "r", status: "running" }));
    repo.insert(task({ id: "d", status: "done" }));
    repo.insert(task({ id: "f", status: "failed", error: "boom" }));
    expect(repo.failInterrupted(99)).toBe(2);
    expect(repo.get("q")).toMatchObject({ status: "failed", error: "interrotto dal riavvio", updatedAt: 99 });
    expect(repo.get("r")?.status).toBe("failed");
    expect(repo.get("d")?.status).toBe("done");
    expect(repo.get("f")?.error).toBe("boom");
  });
});
