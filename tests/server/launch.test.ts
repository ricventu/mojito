import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, statSync, existsSync, writeFileSync, readFileSync, rmSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  launchSession, buildClaudeCommand, launchCustomSession, buildCustomClaudeCommand,
  launchMergeFixSession,
  buildShellCommand, launchShellSession,
  buildResolvePrompt, launchStackResolveSession,
  launchIntakeSession,
  defaultResolveCwd, defaultResolveProjectCwd,
} from "@/server/launch";
import { Registry } from "@/server/registry";
import { EventBus } from "@/server/events";
import type { SessionMeta } from "@/server/types";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "mojito-")); });

const baseReq = {
  ticket: "RIC-46", status: "Planned", model: "opus", effort: "high" as const,
  projectName: "Lime",
  title: "Some ticket", labels: ["Feature"],
  description: "Let the user do the thing from the terminal view.",
};

function deps(over: Record<string, unknown> = {}) {
  return {
    registry: new Registry(dir), stateDir: dir, port: 4711, token: "test-token", projectsPath: "/nope.json",
    hasSession: vi.fn(async () => false),
    newSession: vi.fn(async () => {}),
    pipePane: vi.fn(async () => {}),
    resolveCwd: () => ({ cwd: "/code/lime" }),
    nowIso: () => "2026-07-11T00:00:00.000Z",
    ...over,
  };
}

describe("buildClaudeCommand", () => {
  it("builds a plain claude command with model, effort, settings, and the quoted prompt", () => {
    const cmd = buildClaudeCommand(baseReq, "/state/settings/x.json", "work on RIC-46");
    expect(cmd).toBe("claude --model 'opus' --effort 'high' --settings '/state/settings/x.json' 'work on RIC-46'");
  });

  it("neutralizes shell metacharacters in model/effort", () => {
    const cmd = buildClaudeCommand({ ...baseReq, model: "opus; touch pwned" }, "/s/x.json", "prompt");
    // the injection payload is contained inside a single-quoted token, not a live command
    expect(cmd).toContain("--model 'opus; touch pwned'");
    expect(cmd).not.toContain("; touch pwned "); // never appears unquoted/executable
  });

  it("escapes single quotes in the prompt", () => {
    const cmd = buildClaudeCommand(baseReq, "/s/x.json", "it's fine");
    expect(cmd).toContain("'it'\\''s fine'");
  });

  it("rejects a prompt starting with '-' (argv flag smuggling guard)", () => {
    expect(() => buildClaudeCommand(baseReq, "/s/x.json", "-h")).toThrow();
  });
});

describe("launchSession", () => {
  it("builds a command that starts with claude --model, carries --settings, and embeds the " +
    "ticket id plus the context/result paths inside the quoted prompt — no lime slash command", async () => {
    let command = "";
    const d = deps({ newSession: vi.fn(async (_n: string, _c: string, cmd: string) => { command = cmd; }) });
    await launchSession(baseReq, d);
    expect(command.startsWith("claude --model")).toBe(true);
    expect(command).toContain("--settings");
    expect(command).toContain("RIC-46");
    expect(command).toContain(join(dir, "context", "mojito-RIC-46-planned.json"));
    expect(command).toContain(join(dir, "results", "mojito-RIC-46-planned.json"));
    expect(command).not.toContain("/lime-"); // no lime slash command, and no env-var prefix (it starts with "claude")
  });

  it("refuses a duplicate", async () => {
    const d = deps({ hasSession: vi.fn(async () => true) });
    const res = await launchSession(baseReq, d);
    expect(res).toMatchObject({ ok: false, reason: "duplicate", id: "mojito-RIC-46-planned" });
  });

  it("refuses when no repo resolves", async () => {
    const d = deps({ resolveCwd: () => null });
    const res = await launchSession(baseReq, d);
    expect(res).toMatchObject({ ok: false, reason: "no-repo" });
  });

  it("spawns tmux, pipes the pane, and registers the session", async () => {
    const d = deps();
    const res = await launchSession(baseReq, d);
    expect(res.ok).toBe(true);
    expect(d.newSession).toHaveBeenCalledOnce();
    expect(d.pipePane).toHaveBeenCalledOnce();
    expect(d.registry.get("mojito-RIC-46-planned")?.state).toBe("starting");
    expect(d.registry.get("mojito-RIC-46-planned")?.projectName).toBe("Lime");
    expect((res as { ok: true; meta: { kind: string } }).meta.kind).toBe("ticket");
  });

  it("writes the hook settings file with owner-only permissions", async () => {
    const d = deps();
    const res = await launchSession(baseReq, d);
    expect(res.ok).toBe(true);
    const mode = statSync(join(dir, "settings", "mojito-RIC-46-planned.json")).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("writes the launch context file with owner-only permissions, including the description", async () => {
    const { readFileSync } = await import("node:fs");
    const d = deps();
    await launchSession(baseReq, d);
    const p = join(dir, "context", "mojito-RIC-46-planned.json");
    expect(statSync(p).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(p, "utf8"))).toEqual({
      identifier: "RIC-46", statusName: "Planned",
      title: "Some ticket", project: "Lime", labels: ["Feature"],
      description: "Let the user do the thing from the terminal view.",
    });
  });

  it("clears a stale result file before spawning, not merely by the time launchSession returns " +
    "(ids repeat per ticket+status: the new session's Stop hook must never see the old result)", async () => {
    const resultsDir = join(dir, "results");
    const { mkdirSync, writeFileSync: write, existsSync } = await import("node:fs");
    mkdirSync(resultsDir, { recursive: true });
    const stale = join(resultsDir, "mojito-RIC-46-planned.json");
    write(stale, JSON.stringify({ outcome: "ready-for-qa" }));
    let staleGoneBeforeSpawn: boolean | undefined;
    const d = deps({
      newSession: vi.fn(async () => {
        // Checked from inside the spawn call, before the session process could possibly
        // start — proves clearSessionResult ran before newSession, not just before launchSession
        // returns (which would also pass if the clear happened concurrently/after the spawn).
        staleGoneBeforeSpawn = !existsSync(stale);
      }),
    });
    await launchSession(baseReq, d);
    expect(staleGoneBeforeSpawn).toBe(true);
  });

  it("records title and labels on the session meta", async () => {
    const d = deps();
    await launchSession(baseReq, d);
    const meta = d.registry.get("mojito-RIC-46-planned");
    expect(meta?.title).toBe("Some ticket");
    expect(meta?.labels).toEqual(["Feature"]);
  });

  it("forwards assets and attachments into the context file", async () => {
    const d = deps();
    await launchSession({
      ...baseReq,
      assets: [{ url: "https://uploads.linear.app/w/a.png", localPath: "/state/context/x-assets/01-a.png" }],
      attachments: [{ title: "The PR", url: "https://github.com/x/y/pull/1" }],
    }, d);
    const written = JSON.parse(readFileSync(join(dir, "context", "mojito-RIC-46-planned.json"), "utf8"));
    expect(written.assets).toEqual([
      { url: "https://uploads.linear.app/w/a.png", localPath: "/state/context/x-assets/01-a.png" },
    ]);
    expect(written.attachments).toEqual([{ title: "The PR", url: "https://github.com/x/y/pull/1" }]);
  });

  it("omits the asset fields when the request carries none", async () => {
    const d = deps();
    await launchSession({ ...baseReq, assets: [], attachments: [] }, d);
    const written = JSON.parse(readFileSync(join(dir, "context", "mojito-RIC-46-planned.json"), "utf8"));
    expect("assets" in written).toBe(false);
    expect("attachments" in written).toBe(false);
  });

  it("passes a picked worktree through to resolveCwd", async () => {
    const resolveCwd = vi.fn(() => ({ cwd: "/code/lime/.claude/worktrees/RIC-9-other" }));
    const d = deps({ resolveCwd });
    await launchSession({ ...baseReq, worktree: "/code/lime/.claude/worktrees/RIC-9-other" }, d);
    expect(resolveCwd).toHaveBeenCalledWith(expect.objectContaining({
      worktree: "/code/lime/.claude/worktrees/RIC-9-other",
    }));
  });

  it("passes createWorktree/baseBranch and the ticket's title through to resolveCwd", async () => {
    const resolveCwd = vi.fn(() => ({ cwd: "/code/lime" }));
    const d = deps({ resolveCwd });
    await launchSession({ ...baseReq, createWorktree: true, baseBranch: "main" }, d);
    expect(resolveCwd).toHaveBeenCalledWith({
      ticket: "RIC-46", projectName: "Lime", title: "Some ticket",
      createWorktree: true, baseBranch: "main",
    });
  });

  it("echoes a warning from resolveCwd as the first thing the session's terminal runs", async () => {
    let command = "";
    const d = deps({
      resolveCwd: () => ({ cwd: "/code/lime", warning: "init-worktree.sh not found" }),
      newSession: vi.fn(async (_n: string, _c: string, cmd: string) => { command = cmd; }),
    });
    await launchSession(baseReq, d);
    expect(command.startsWith("echo ")).toBe(true);
    expect(command).toContain("init-worktree.sh not found");
    expect(command).toContain("; claude --model");
  });

  it("runs no echo prefix when resolveCwd reports no warning", async () => {
    let command = "";
    const d = deps({ newSession: vi.fn(async (_n: string, _c: string, cmd: string) => { command = cmd; }) });
    await launchSession(baseReq, d);
    expect(command.startsWith("claude --model")).toBe(true);
  });
});

function customDeps(over: Record<string, unknown> = {}) {
  return {
    registry: new Registry(dir), stateDir: dir, port: 4711, token: "test-token",
    projectsPath: "/nope.json",
    hasSession: vi.fn(async () => false),
    newSession: vi.fn(async () => {}),
    pipePane: vi.fn(async () => {}),
    resolveCwd: () => ({ cwd: "/code/Lime/mojito/.worktrees/ricventu/ric-128-x" }),
    nowIso: () => "2026-07-11T00:00:00.000Z",
    genId: () => "abc123",
    homeDir: () => "/home/me",
    shell: () => "/bin/zsh",
    ...over,
  };
}

describe("buildCustomClaudeCommand", () => {
  it("builds a bare claude command with no slash command and no context-file prefix", () => {
    // Exact match: nothing precedes "claude" (no env-var prefix) and no slash command follows.
    const cmd = buildCustomClaudeCommand({ projectName: null, model: "opus", effort: "high" }, "/s/x.json");
    expect(cmd).toBe("claude --model 'opus' --effort 'high' --settings '/s/x.json'");
  });

  describe("prompt", () => {
    const base = { projectName: "Factorybook", model: "opus", effort: "high" as const };
    it("appends the prompt as a single quoted positional arg", () => {
      const cmd = buildCustomClaudeCommand({ ...base, prompt: "align the branch" }, "/s/x.json");
      expect(cmd).toBe("claude --model 'opus' --effort 'high' --settings '/s/x.json' 'align the branch'");
    });
    it("is unchanged when no prompt is given", () => {
      const cmd = buildCustomClaudeCommand(base, "/s/x.json");
      expect(cmd).toBe("claude --model 'opus' --effort 'high' --settings '/s/x.json'");
    });
    it("escapes single quotes in the prompt", () => {
      const cmd = buildCustomClaudeCommand({ ...base, prompt: "it's fine" }, "/s/x.json");
      expect(cmd).toBe("claude --model 'opus' --effort 'high' --settings '/s/x.json' 'it'\\''s fine'");
    });
    it("rejects a prompt starting with '-' (argv flag smuggling guard)", () => {
      expect(() => buildCustomClaudeCommand({ ...base, prompt: "-h" }, "/s/x.json")).toThrow();
    });
  });
});

describe("launchCustomSession", () => {
  it("General opens in the home directory with a home label", async () => {
    const d = customDeps();
    const res = await launchCustomSession({ projectName: null, model: "opus", effort: "high" }, d);
    expect(res.ok).toBe(true);
    const meta = (res as { ok: true; meta: SessionMeta }).meta;
    expect(meta).toMatchObject({ kind: "custom", id: "mojito-custom-general-abc123", ticket: "",
      launchStatus: "", cwd: "/home/me", projectName: null, title: "home" });
    expect(d.newSession).toHaveBeenCalledWith("mojito-custom-general-abc123", "/home/me",
      expect.stringContaining("claude --model 'opus'"));
  });

  it("a mapped project opens in its folder with the basename label", async () => {
    const projectsPath = join(dir, "projects.json");
    writeFileSync(projectsPath, JSON.stringify({ RIC: { projects: { Mojito: "/code/Lime/mojito" } } }));
    const d = customDeps({ projectsPath });
    const res = await launchCustomSession({ projectName: "Mojito", model: "sonnet", effort: "low" }, d);
    expect(res.ok).toBe(true);
    const meta = (res as { ok: true; meta: SessionMeta }).meta;
    expect(meta).toMatchObject({ kind: "custom", id: "mojito-custom-mojito-abc123",
      cwd: "/code/Lime/mojito", projectName: "Mojito", title: "mojito" });
  });

  it("writes hook settings but NO launch-context file", async () => {
    const d = customDeps();
    await launchCustomSession({ projectName: null, model: "opus", effort: "high" }, d);
    expect(existsSync(join(dir, "settings", "mojito-custom-general-abc123.json"))).toBe(true);
    expect(existsSync(join(dir, "context", "mojito-custom-general-abc123.json"))).toBe(false);
  });

  it("refuses an unmapped project", async () => {
    const d = customDeps();
    const res = await launchCustomSession({ projectName: "Ghost", model: "opus", effort: "high" }, d);
    expect(res).toMatchObject({ ok: false, reason: "no-repo" });
  });

  it("registers the session in the registry", async () => {
    const d = customDeps();
    const res = await launchCustomSession({ projectName: null, model: "opus", effort: "high" }, d);
    const id = (res as { ok: true; meta: SessionMeta }).meta.id;
    expect(d.registry.get(id)?.kind).toBe("custom");
  });

  it("opens a project-scoped session in a picked worktree", async () => {
    const d = customDeps({ resolveProjectCwd: () => ({ cwd: "/code/Lime/mojito/.claude/worktrees/RIC-9-x" }) });
    const res = await launchCustomSession({ projectName: "Mojito", model: "opus", effort: "high", worktree: "/code/Lime/mojito/.claude/worktrees/RIC-9-x" }, d);
    const meta = (res as { ok: true; meta: SessionMeta }).meta;
    expect(meta.cwd).toBe("/code/Lime/mojito/.claude/worktrees/RIC-9-x");
    // The label follows the directory, so the session card names the worktree it is in.
    expect(meta.title).toBe("RIC-9-x");
  });

  it("passes the picked worktree to resolveProjectCwd for a project-scoped session", async () => {
    const resolveProjectCwd = vi.fn(() => ({ cwd: "/code/Lime/mojito" }));
    const d = customDeps({ resolveProjectCwd });
    await launchCustomSession({ projectName: "Mojito", model: "opus", effort: "high", worktree: "/wt/x" }, d);
    expect(resolveProjectCwd).toHaveBeenCalledWith({ projectName: "Mojito", worktree: "/wt/x" });
  });

  it("echoes a resolveProjectCwd warning before the claude command", async () => {
    let command = "";
    const d = customDeps({
      resolveProjectCwd: () => ({ cwd: "/code/Lime/mojito", warning: "that worktree is gone" }),
      newSession: vi.fn(async (_n: string, _c: string, cmd: string) => { command = cmd; }),
    });
    await launchCustomSession({ projectName: "Mojito", model: "opus", effort: "high", worktree: "/wt/gone" }, d);
    expect(command.startsWith("echo ")).toBe(true);
    expect(command).toContain("that worktree is gone");
  });

  it("never resolves a worktree for General — there is no repo to pick one from", async () => {
    const resolveProjectCwd = vi.fn(() => ({ cwd: "/nope" }));
    const d = customDeps({ resolveProjectCwd });
    const res = await launchCustomSession({ projectName: null, model: "opus", effort: "high", worktree: "/wt/x" }, d);
    expect(resolveProjectCwd).not.toHaveBeenCalled();
    expect((res as { ok: true; meta: SessionMeta }).meta.cwd).toBe("/home/me");
  });
});

const baseConflictReq = {
  ticket: "RIC-120", projectName: "Mojito", title: "some ticket title",
  description: "Let the user do the thing.", model: "opus", effort: "xhigh" as const,
  mergeMode: "local" as const, blocker: "CONFLICT (content): src/a.ts",
};

describe("launchMergeFixSession", () => {
  it("launches a ticket-kind session at To QA under the -conflict id, seeded with the merge-fix prompt", async () => {
    let command = "";
    const d = deps({ newSession: vi.fn(async (_n: string, _c: string, cmd: string) => { command = cmd; }) });
    const res = await launchMergeFixSession(baseConflictReq, d);
    expect(res.ok).toBe(true);
    const meta = (res as { ok: true; meta: SessionMeta }).meta;
    expect(meta).toMatchObject({
      kind: "ticket", id: "mojito-RIC-120-conflict", ticket: "RIC-120",
      launchStatus: "To QA", state: "starting", cwd: "/code/lime",
    });
    expect(meta.id.endsWith("-conflict")).toBe(true);
    // The merge-fix prompt, not the work prompt, and no lime slash command.
    expect(command.startsWith("claude --model")).toBe(true);
    expect(command).toContain("QA-approved branch");
    expect(command).toContain("CONFLICT (content): src/a.ts"); // the blocker is embedded
    expect(command).toContain("--ff-only"); // local-mode completion step
    expect(command).toContain(join(dir, "context", "mojito-RIC-120-conflict.json"));
    expect(command).toContain(join(dir, "results", "mojito-RIC-120-conflict.json"));
    expect(command).not.toContain("/lime-");
  });

  it("writes a launch context at To QA carrying the description and no labels", async () => {
    const d = deps();
    await launchMergeFixSession(baseConflictReq, d);
    const p = join(dir, "context", "mojito-RIC-120-conflict.json");
    expect(JSON.parse(readFileSync(p, "utf8"))).toEqual({
      identifier: "RIC-120", statusName: "To QA", title: "some ticket title",
      project: "Mojito", labels: [], description: "Let the user do the thing.",
    });
  });

  it("clears a stale result file before spawning", async () => {
    const { mkdirSync, writeFileSync: write } = await import("node:fs");
    mkdirSync(join(dir, "results"), { recursive: true });
    const stale = join(dir, "results", "mojito-RIC-120-conflict.json");
    write(stale, JSON.stringify({ outcome: "ready-for-qa" }));
    let goneBeforeSpawn: boolean | undefined;
    const d = deps({ newSession: vi.fn(async () => { goneBeforeSpawn = !existsSync(stale); }) });
    await launchMergeFixSession(baseConflictReq, d);
    expect(goneBeforeSpawn).toBe(true);
  });

  it("refuses a duplicate", async () => {
    const d = deps({ hasSession: vi.fn(async () => true) });
    const res = await launchMergeFixSession(baseConflictReq, d);
    expect(res).toMatchObject({ ok: false, reason: "duplicate", id: "mojito-RIC-120-conflict" });
  });

  it("refuses when no repo resolves", async () => {
    const d = deps({ resolveCwd: () => null });
    const res = await launchMergeFixSession(baseConflictReq, d);
    expect(res).toMatchObject({ ok: false, reason: "no-repo" });
  });
});

describe("launchCustomSession from a ticket (RIC-128)", () => {
  const ticketReq = { projectName: "Mojito", model: "opus", effort: "high" as const,
    ticket: "RIC-128", status: "Todo", title: "Custom session from a ticket", labels: ["Feature"] };

  it("opens in the ticket's worktree and carries ticket/title/labels on the meta", async () => {
    const d = customDeps({ resolveCwd: () => ({ cwd: "/wt/ric-128" }) });
    const res = await launchCustomSession(ticketReq, d);
    expect(res.ok).toBe(true);
    const meta = (res as { ok: true; meta: SessionMeta }).meta;
    expect(meta).toMatchObject({ kind: "custom", id: "mojito-custom-ric-128-abc123",
      ticket: "RIC-128", launchStatus: "", cwd: "/wt/ric-128", projectName: "Mojito",
      title: "Custom session from a ticket", labels: ["Feature"] });
  });

  it("writes NO launch-context file (a bare interactive session, human-driven)", async () => {
    const d = customDeps({ resolveCwd: () => ({ cwd: "/wt/ric-128" }) });
    await launchCustomSession(ticketReq, d);
    expect(existsSync(join(dir, "context", "mojito-custom-ric-128-abc123.json"))).toBe(false);
    // Exact match: nothing precedes "claude" (no env-var prefix) and no slash command follows.
    expect(d.newSession).toHaveBeenCalledWith("mojito-custom-ric-128-abc123", "/wt/ric-128",
      "claude --model 'opus' --effort 'high' --settings " +
      `'${join(dir, "settings", "mojito-custom-ric-128-abc123.json")}'`);
  });

  it("falls back to the repo root when no worktree exists", async () => {
    const d = customDeps({ resolveCwd: () => ({ cwd: "/code/Lime/mojito" }) });
    const res = await launchCustomSession(ticketReq, d);
    expect(res.ok).toBe(true);
    expect((res as { ok: true; meta: SessionMeta }).meta.cwd).toBe("/code/Lime/mojito");
  });

  it("refuses when the ticket's team/project is unmapped", async () => {
    const d = customDeps({ resolveCwd: () => null });
    const res = await launchCustomSession(ticketReq, d);
    expect(res).toMatchObject({ ok: false, reason: "no-repo" });
  });

  it("passes a picked worktree through to resolveCwd", async () => {
    const resolveCwd = vi.fn(() => ({ cwd: "/wt/other" }));
    const d = customDeps({ resolveCwd });
    await launchCustomSession({ ...ticketReq, worktree: "/wt/other" }, d);
    expect(resolveCwd).toHaveBeenCalledWith(expect.objectContaining({ worktree: "/wt/other" }));
  });

  it("passes createWorktree/baseBranch through to resolveCwd", async () => {
    const resolveCwd = vi.fn(() => ({ cwd: "/wt/ric-128" }));
    const d = customDeps({ resolveCwd });
    await launchCustomSession({ ...ticketReq, createWorktree: true, baseBranch: "main" }, d);
    expect(resolveCwd).toHaveBeenCalledWith({
      ticket: "RIC-128", projectName: "Mojito", title: "Custom session from a ticket",
      createWorktree: true, baseBranch: "main",
    });
  });

  it("echoes a resolveCwd warning before the claude command", async () => {
    let command = "";
    const d = customDeps({
      resolveCwd: () => ({ cwd: "/wt/ric-128", warning: "setup script failed" }),
      newSession: vi.fn(async (_n: string, _c: string, cmd: string) => { command = cmd; }),
    });
    await launchCustomSession(ticketReq, d);
    expect(command.startsWith("echo ")).toBe(true);
    expect(command).toContain("setup script failed");
  });
});

describe("buildShellCommand", () => {
  it("uses the given login shell with no claude, settings, or slash command", () => {
    const cmd = buildShellCommand("/bin/zsh");
    expect(cmd).toBe("/bin/zsh -l");
    expect(cmd).not.toContain("claude");
    expect(cmd).not.toContain("--settings");
    expect(cmd).not.toContain("/lime");
  });
  it("falls back to bash when no login shell is configured (e.g. Linux without zsh)", () => {
    expect(buildShellCommand(undefined)).toBe("/bin/bash -l");
    expect(buildShellCommand("")).toBe("/bin/bash -l");
    expect(buildShellCommand("   ")).toBe("/bin/bash -l");
  });
});

describe("launchShellSession", () => {
  it("General opens a shell in the home directory, running, with empty model/effort", async () => {
    const d = customDeps();
    const res = await launchShellSession({ projectName: null }, d);
    expect(res.ok).toBe(true);
    const meta = (res as { ok: true; meta: SessionMeta }).meta;
    expect(meta).toMatchObject({ kind: "shell", id: "mojito-shell-general-abc123", ticket: "",
      launchStatus: "", cwd: "/home/me", projectName: null, title: "home",
      state: "running", model: "", effort: "" });
    expect(d.newSession).toHaveBeenCalledWith("mojito-shell-general-abc123", "/home/me", "/bin/zsh -l");
    expect(d.pipePane).toHaveBeenCalledOnce();
  });

  it("a mapped project opens a shell in its folder with the basename label", async () => {
    const projectsPath = join(dir, "projects.json");
    writeFileSync(projectsPath, JSON.stringify({ RIC: { projects: { Mojito: "/code/Lime/mojito" } } }));
    const d = customDeps({ projectsPath });
    const res = await launchShellSession({ projectName: "Mojito" }, d);
    expect(res.ok).toBe(true);
    const meta = (res as { ok: true; meta: SessionMeta }).meta;
    expect(meta).toMatchObject({ kind: "shell", id: "mojito-shell-mojito-abc123",
      cwd: "/code/Lime/mojito", projectName: "Mojito", title: "mojito" });
  });

  it("writes NEITHER a hook-settings file NOR a launch-context file", async () => {
    const d = customDeps();
    await launchShellSession({ projectName: null }, d);
    expect(existsSync(join(dir, "settings", "mojito-shell-general-abc123.json"))).toBe(false);
    expect(existsSync(join(dir, "context", "mojito-shell-general-abc123.json"))).toBe(false);
  });

  it("refuses an unmapped project", async () => {
    const d = customDeps();
    const res = await launchShellSession({ projectName: "Ghost" }, d);
    expect(res).toMatchObject({ ok: false, reason: "no-repo" });
  });

  it("registers the session in the registry", async () => {
    const d = customDeps();
    const res = await launchShellSession({ projectName: null }, d);
    const id = (res as { ok: true; meta: SessionMeta }).meta.id;
    expect(d.registry.get(id)?.kind).toBe("shell");
  });

  it("a ticket-scoped shell opens in the worktree with ticket/title/labels and no context file", async () => {
    const d = customDeps({ resolveCwd: () => ({ cwd: "/wt/ric-155" }) });
    const res = await launchShellSession(
      { projectName: "Mojito", ticket: "RIC-155", status: "Todo", title: "Avvio terminale", labels: ["Feature"] }, d);
    expect(res.ok).toBe(true);
    const meta = (res as { ok: true; meta: SessionMeta }).meta;
    expect(meta).toMatchObject({ kind: "shell", id: "mojito-shell-ric-155-abc123",
      ticket: "RIC-155", launchStatus: "", cwd: "/wt/ric-155", projectName: "Mojito",
      title: "Avvio terminale", labels: ["Feature"], state: "running" });
    expect(existsSync(join(dir, "context", "mojito-shell-ric-155-abc123.json"))).toBe(false);
    expect(d.newSession).toHaveBeenCalledWith("mojito-shell-ric-155-abc123", "/wt/ric-155", "/bin/zsh -l");
  });

  it("falls back to bash when the host has no login shell configured", async () => {
    const d = customDeps({ shell: () => undefined });
    await launchShellSession({ projectName: null }, d);
    expect(d.newSession).toHaveBeenCalledWith("mojito-shell-general-abc123", "/home/me", "/bin/bash -l");
  });

  it("refuses when the ticket's team/project is unmapped", async () => {
    const d = customDeps({ resolveCwd: () => null });
    const res = await launchShellSession({ projectName: "Mojito", ticket: "RIC-155" }, d);
    expect(res).toMatchObject({ ok: false, reason: "no-repo" });
  });

  it("passes createWorktree/baseBranch through to resolveCwd for a ticket-scoped shell", async () => {
    const resolveCwd = vi.fn(() => ({ cwd: "/wt/ric-155" }));
    const d = customDeps({ resolveCwd });
    await launchShellSession(
      { projectName: "Mojito", ticket: "RIC-155", status: "Todo", title: "Avvio terminale",
        createWorktree: true, baseBranch: "develop" }, d);
    expect(resolveCwd).toHaveBeenCalledWith({
      ticket: "RIC-155", projectName: "Mojito", title: "Avvio terminale",
      createWorktree: true, baseBranch: "develop",
    });
  });

  it("passes a picked worktree through to resolveCwd for a ticket-scoped shell", async () => {
    const resolveCwd = vi.fn(() => ({ cwd: "/wt/other" }));
    const d = customDeps({ resolveCwd });
    await launchShellSession({ projectName: "Mojito", ticket: "RIC-155", worktree: "/wt/other" }, d);
    expect(resolveCwd).toHaveBeenCalledWith(expect.objectContaining({ worktree: "/wt/other" }));
  });

  it("opens a project-scoped terminal in a picked worktree", async () => {
    const d = customDeps({ resolveProjectCwd: () => ({ cwd: "/code/Lime/mojito/.claude/worktrees/RIC-9-x" }) });
    const res = await launchShellSession({ projectName: "Mojito", worktree: "/code/Lime/mojito/.claude/worktrees/RIC-9-x" }, d);
    expect((res as { ok: true; meta: SessionMeta }).meta.cwd).toBe("/code/Lime/mojito/.claude/worktrees/RIC-9-x");
  });

  it("echoes a resolveCwd warning before the shell command", async () => {
    let command = "";
    const d = customDeps({
      resolveCwd: () => ({ cwd: "/wt/ric-155", warning: "setup script failed" }),
      newSession: vi.fn(async (_n: string, _c: string, cmd: string) => { command = cmd; }),
    });
    await launchShellSession({ projectName: "Mojito", ticket: "RIC-155" }, d);
    expect(command.startsWith("echo ")).toBe(true);
    expect(command).toContain("setup script failed");
    expect(command).toContain("/bin/zsh -l");
  });
});

function gitAvailable(): boolean {
  try { execFileSync("git", ["--version"], { stdio: "ignore" }); return true; } catch { return false; }
}
const withGit = gitAvailable() ? describe : describe.skip;
const SANDBOX_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: SANDBOX_ENV }).trim();
}
function configureRepo(repoDir: string): void {
  git(repoDir, ["config", "user.email", "mojito-test@example.com"]);
  git(repoDir, ["config", "user.name", "Mojito Test"]);
  git(repoDir, ["config", "commit.gpgsign", "false"]);
}

withGit("defaultResolveCwd (real git, the wiring launchSession et al. use by default)", () => {
  const roots: string[] = [];
  afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });

  function makeRepo(): { repo: string; projectsPath: string } {
    const root = mkdtempSync(join(tmpdir(), "mojito-resolvecwd-"));
    roots.push(root);
    const repo = join(root, "repo");
    mkdirSync(repo);
    git(repo, ["init", "-b", "main"]);
    configureRepo(repo);
    writeFileSync(join(repo, "base.txt"), "base\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "--no-gpg-sign", "-m", "init"]);
    // git resolves symlinks when it reports a worktree's path (e.g. macOS /var -> /private/var);
    // realpath here so string comparisons against defaultResolveCwd's own output line up.
    const realRepo = realpathSync(repo);
    const projectsPath = join(root, "projects.json");
    writeFileSync(projectsPath, JSON.stringify({ RIC: realRepo }));
    return { repo: realRepo, projectsPath };
  }

  it("resolves the repo root when no worktree exists and none is requested", async () => {
    const { repo, projectsPath } = makeRepo();
    const resolveCwd = defaultResolveCwd(projectsPath);
    await expect(resolveCwd({ ticket: "RIC-1", projectName: "Mojito", title: "Some thing", createWorktree: false }))
      .resolves.toEqual({ cwd: repo });
  });

  it("creates a slugged worktree off the given base branch when asked", async () => {
    const { repo, projectsPath } = makeRepo();
    const resolveCwd = defaultResolveCwd(projectsPath);
    const res = await resolveCwd({ ticket: "RIC-1", projectName: "Mojito", title: "Some thing", createWorktree: true, baseBranch: "main" });
    expect(res?.cwd).toBe(join(repo, ".claude", "worktrees", "RIC-1-some-thing"));
    expect(existsSync(res!.cwd)).toBe(true);
  });

  it("resolves the already-created worktree on a later call instead of creating again", async () => {
    const { projectsPath } = makeRepo();
    const resolveCwd = defaultResolveCwd(projectsPath);
    const opts = { ticket: "RIC-1", projectName: "Mojito", title: "Some thing", createWorktree: true, baseBranch: "main" };
    const first = await resolveCwd(opts);
    const second = await resolveCwd(opts);
    expect(second).toEqual({ cwd: first!.cwd });
  });

  it("returns null when the ticket maps to no repo", async () => {
    const { projectsPath } = makeRepo();
    const resolveCwd = defaultResolveCwd(projectsPath);
    await expect(resolveCwd({ ticket: "ZZZ-1", projectName: "Mojito", title: "x", createWorktree: false })).resolves.toBeNull();
  });

  it("opens a picked worktree instead of creating one", async () => {
    const { repo, projectsPath } = makeRepo();
    const other = join(repo, ".claude", "worktrees", "RIC-9-other");
    git(repo, ["worktree", "add", other, "-b", "RIC-9-other"]);
    const resolveCwd = defaultResolveCwd(projectsPath);
    await expect(resolveCwd({ ticket: "RIC-1", projectName: "Mojito", title: "Some thing",
      createWorktree: true, baseBranch: "main", worktree: other }))
      .resolves.toEqual({ cwd: other });
    // The pick was honoured, so nothing was created for RIC-1.
    expect(existsSync(join(repo, ".claude", "worktrees", "RIC-1-some-thing"))).toBe(false);
  });

  // The pick is explicit and the resolution is not, so the pick wins — otherwise a
  // deliberate choice would be silently overridden by a branch-name match.
  it("prefers the pick over the ticket's own existing worktree", async () => {
    const { repo, projectsPath } = makeRepo();
    const own = join(repo, ".claude", "worktrees", "RIC-1-some-thing");
    git(repo, ["worktree", "add", own, "-b", "RIC-1-some-thing"]);
    const other = join(repo, ".claude", "worktrees", "RIC-9-other");
    git(repo, ["worktree", "add", other, "-b", "RIC-9-other"]);
    const resolveCwd = defaultResolveCwd(projectsPath);
    await expect(resolveCwd({ ticket: "RIC-1", projectName: "Mojito", title: "Some thing", createWorktree: false, worktree: other }))
      .resolves.toEqual({ cwd: other });
  });

  // The realistic case: the worktree was removed between the sheet's fetch and the tap.
  it("falls back to the repo root with a warning when the picked worktree is not one of the repo's", async () => {
    const { repo, projectsPath } = makeRepo();
    const resolveCwd = defaultResolveCwd(projectsPath);
    const res = await resolveCwd({ ticket: "RIC-1", projectName: "Mojito", title: "Some thing",
      createWorktree: false, worktree: join(repo, "..", "elsewhere") });
    expect(res?.cwd).toBe(repo);
    expect(res?.warning).toBeTruthy();
  });
});

withGit("defaultResolveProjectCwd (real git, the project-scoped wiring)", () => {
  const roots: string[] = [];
  afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });

  function makeRepo(): { repo: string; projectsPath: string } {
    const root = mkdtempSync(join(tmpdir(), "mojito-projectcwd-"));
    roots.push(root);
    const repo = join(root, "repo");
    mkdirSync(repo);
    git(repo, ["init", "-b", "main"]);
    configureRepo(repo);
    writeFileSync(join(repo, "base.txt"), "base\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "--no-gpg-sign", "-m", "init"]);
    const realRepo = realpathSync(repo);
    const projectsPath = join(root, "projects.json");
    writeFileSync(projectsPath, JSON.stringify({ RIC: { projects: { Mojito: realRepo } } }));
    return { repo: realRepo, projectsPath };
  }

  it("resolves the project's repo root when nothing is picked", () => {
    const { repo, projectsPath } = makeRepo();
    expect(defaultResolveProjectCwd(projectsPath)({ projectName: "Mojito" })).toEqual({ cwd: repo });
  });

  it("opens a picked worktree of that project", () => {
    const { repo, projectsPath } = makeRepo();
    const other = join(repo, ".claude", "worktrees", "RIC-9-other");
    git(repo, ["worktree", "add", other, "-b", "RIC-9-other"]);
    expect(defaultResolveProjectCwd(projectsPath)({ projectName: "Mojito", worktree: other })).toEqual({ cwd: other });
  });

  it("falls back to the repo root with a warning for a worktree the repo does not have", () => {
    const { repo, projectsPath } = makeRepo();
    const res = defaultResolveProjectCwd(projectsPath)({ projectName: "Mojito", worktree: "/etc" });
    expect(res?.cwd).toBe(repo);
    expect(res?.warning).toBeTruthy();
  });

  it("returns null for an unmapped project", () => {
    const { projectsPath } = makeRepo();
    expect(defaultResolveProjectCwd(projectsPath)({ projectName: "Ghost" })).toBeNull();
  });
});

describe("buildResolvePrompt", () => {
  it("embeds only server-derived values (project, repo, branch)", () => {
    const p = buildResolvePrompt("Factorybook", "/repo/fb", "main");
    expect(p).toContain("Factorybook");
    expect(p).toContain("/repo/fb");
    expect(p).toContain("main");
    expect(p).toMatch(/fast-forward/i);
    expect(p).toMatch(/force-push/i); // instructs NOT to force-push
  });
});

describe("launchStackResolveSession", () => {
  it("launches a project-scoped custom session seeded with the resolve prompt", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "mojito-launch-"));
    let command = "";
    const projectsPath = join(stateDir, "projects.json");
    writeFileSync(projectsPath, JSON.stringify({ RIC: { projects: { Factorybook: "/repo/fb" } } }));
    const res = await launchStackResolveSession(
      { projectName: "Factorybook", branch: "feature/x" },
      {
        registry: new Registry(stateDir),
        stateDir,
        port: 4711,
        token: "t",
        projectsPath,
        hasSession: async () => false,
        newSession: async (_n, _c, cmd) => { command = cmd; },
        pipePane: async () => {},
        genId: () => "abc123",
        homeDir: () => "/home/me",
      },
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.meta.kind).toBe("custom");
      expect(res.meta.projectName).toBe("Factorybook");
      // Analytical-resolve profile is inlined (opus/xhigh), not resolved via a status
      // that no longer exists in BUILTIN_STAGE_DEFAULTS (formerly "To Merge").
      expect(res.meta.model).toBe("opus");
      expect(res.meta.effort).toBe("xhigh");
    }
    // Command carries the seeded prompt as the final quoted arg, and no client string.
    expect(command).toMatch(/claude --model .* --effort .* --settings .* '.*force-push.*'/s);
  });
});

// The intake session (New-ticket sheet): mechanically a custom session whose whole job is
// to turn the human's rough note into a Linear issue, so it carries no ticket and reports
// nothing back to Mojito — the issue it creates is the result. It registers under its own
// kind and id prefix all the same (RIC-251), which is what lets the board name it.
describe("launchIntakeSession", () => {
  function intakeDeps(over: Record<string, unknown> = {}) {
    const projectsPath = join(dir, "projects.json");
    writeFileSync(projectsPath, JSON.stringify({ RIC: { projects: { Mojito: "/code/mojito" } } }));
    return {
      registry: new Registry(dir), stateDir: dir, port: 4711, token: "t", projectsPath,
      hasSession: vi.fn(async () => false),
      newSession: vi.fn(async (_name: string, _cwd: string, _command: string) => {}),
      pipePane: vi.fn(async () => {}),
      genId: () => "abc123",
      homeDir: () => "/home/me",
      nowIso: () => "2026-08-19T00:00:00.000Z",
      ...over,
    };
  }

  const intakeReq = {
    projectName: "Mojito", teamKey: "RIC", draftPath: "/state/drafts/ab12cd.json", hasImages: true,
  };

  it("opens the project's repo on sonnet at medium effort, seeded with the intake prompt", async () => {
    const d = intakeDeps();
    const res = await launchIntakeSession(intakeReq, d);
    expect(res.ok).toBe(true);
    const meta = (res as { ok: true; meta: SessionMeta }).meta;
    expect(meta).toMatchObject({ kind: "intake", ticket: "", cwd: "/code/mojito", model: "sonnet", effort: "medium" });
    const command = d.newSession.mock.calls[0][2];
    expect(command).toContain("--model 'sonnet' --effort 'medium'");
    expect(command).toContain("/state/drafts/ab12cd.json");
  });

  it("opens in the home directory for a General ticket", async () => {
    const d = intakeDeps();
    const res = await launchIntakeSession({ ...intakeReq, projectName: null }, d);
    expect((res as { ok: true; meta: SessionMeta }).meta.cwd).toBe("/home/me");
  });

  // RIC-223. The images half of the prompt hangs off the draft, so an imageless note must
  // reach the session with no mention of images at all.
  it("seeds the images instruction only when the draft carries images", async () => {
    const withImages = intakeDeps();
    await launchIntakeSession(intakeReq, withImages);
    expect(withImages.newSession.mock.calls[0][2]).toContain("imageUrls");
    const without = intakeDeps();
    await launchIntakeSession({ ...intakeReq, hasImages: false }, without);
    expect(without.newSession.mock.calls[0][2]).not.toContain("imageUrls");
  });

  it("refuses a project that maps to no repository", async () => {
    const res = await launchIntakeSession({ ...intakeReq, projectName: "Ghost" }, intakeDeps());
    expect(res).toMatchObject({ ok: false, reason: "no-repo" });
  });

  // RIC-251: the board showed this session as an ordinary "Custom" one, indistinguishable
  // from a claude session the human started themselves. The kind is what the status bucket
  // reads (sessionStatus), and the id prefix is what tmux and orphan adoption read.
  it("registers as an intake session, under its own id prefix", async () => {
    const d = intakeDeps();
    const res = await launchIntakeSession(intakeReq, d);
    const meta = (res as { ok: true; meta: SessionMeta }).meta;
    expect(meta.kind).toBe("intake");
    expect(meta.id).toBe("mojito-intake-mojito-abc123");
    expect(d.newSession.mock.calls[0][0]).toBe("mojito-intake-mojito-abc123");
  });

  // The flag is the intake launcher's alone: a session started from the New session sheet
  // is a plain custom one and must keep saying so.
  it("leaves an ordinary custom launch as custom", async () => {
    const d = intakeDeps();
    const res = await launchCustomSession({ projectName: "Mojito", model: "opus", effort: "high" }, d);
    const meta = (res as { ok: true; meta: SessionMeta }).meta;
    expect(meta.kind).toBe("custom");
    expect(meta.id).toBe("mojito-custom-mojito-abc123");
  });
});

// RIC-222: a session's state comes only from Claude Code hooks, and none of them fires
// while claude is blocked before boot (the workspace-trust prompt). Every launcher that
// registers a session at "starting" therefore arms the startup-stall watch, which flips
// such a launch to needs-input — the honest state for a terminal waiting on a human.
describe("startup-stall watch (RIC-222)", () => {
  // hasSession answers the launchers' duplicate check first (no session yet), then the
  // watch's own liveness probe once the grace period is up (tmux alive, claude silent).
  function stallDeps<T>(base: (over: Record<string, unknown>) => T) {
    let launched = false;
    const armed: { ms: number; fn: () => void }[] = [];
    const events: string[] = [];
    const bus = new EventBus();
    bus.subscribe((e) => events.push(e.type));
    const d = base({
      bus,
      hasSession: vi.fn(async () => launched),
      newSession: vi.fn(async () => { launched = true; }),
      scheduleStall: (fn: () => void, ms: number) => { armed.push({ fn, ms }); },
    });
    return { d, armed, events };
  }

  it("a ticket launch arms it, and a silent claude becomes needs-input", async () => {
    const { d, armed, events } = stallDeps(deps);
    const res = await launchSession(baseReq, d);
    const { id } = (res as { ok: true; meta: SessionMeta }).meta;
    expect(armed).toHaveLength(1);
    expect(d.registry.get(id)?.state).toBe("starting");

    await armed[0].fn();

    expect(d.registry.get(id)?.state).toBe("needs-input");
    expect(events).toEqual(["session.state", "session.alert"]);
  });

  it("a custom launch arms it — the kind the bug was reported on", async () => {
    const { d, armed } = stallDeps(customDeps);
    const res = await launchCustomSession({ projectName: null, model: "opus", effort: "high" }, d);
    const { id } = (res as { ok: true; meta: SessionMeta }).meta;
    expect(armed).toHaveLength(1);

    await armed[0].fn();

    expect(d.registry.get(id)?.state).toBe("needs-input");
  });

  it("a merge-fix launch arms it", async () => {
    const { d, armed } = stallDeps(deps);
    const res = await launchMergeFixSession(baseConflictReq, d);
    const { id } = (res as { ok: true; meta: SessionMeta }).meta;
    expect(armed).toHaveLength(1);

    await armed[0].fn();

    expect(d.registry.get(id)?.state).toBe("needs-input");
  });

  // A shell fires no hooks at all, which is why it launches at "running" rather than
  // "starting" — there is no stall to watch for, and nothing to ask the human.
  it("a shell launch arms nothing", async () => {
    const { d, armed } = stallDeps(customDeps);
    const res = await launchShellSession({ projectName: null }, d);
    expect((res as { ok: true; meta: SessionMeta }).meta.state).toBe("running");
    expect(armed).toHaveLength(0);
  });
});
