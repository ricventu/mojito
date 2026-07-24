import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, statSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  launchSession, buildClaudeCommand, launchCustomSession, buildCustomClaudeCommand,
  launchNewTicketSession, buildNewTicketClaudeCommand,
  launchRebaseSession, buildRebaseClaudeCommand,
  buildShellCommand, launchShellSession,
  buildResolvePrompt, launchStackResolveSession,
} from "@/server/launch";
import { Registry } from "@/server/registry";
import type { SessionMeta } from "@/server/types";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "mojito-")); });

const baseReq = {
  ticket: "RIC-46", status: "Planned", model: "opus", effort: "high" as const,
  autoAdvance: false, projectName: "Lime",
  title: "Auto-advance toggle", labels: ["Feature"],
};

function deps(over: Record<string, unknown> = {}) {
  return {
    registry: new Registry(dir), stateDir: dir, port: 4711, token: "test-token", projectsPath: "/nope.json",
    hasSession: vi.fn(async () => false),
    newSession: vi.fn(async () => {}),
    pipePane: vi.fn(async () => {}),
    resolveCwd: () => "/code/lime",
    nowIso: () => "2026-07-11T00:00:00.000Z",
    ...over,
  };
}

describe("launchSession", () => {
  it("builds a claude command with model, effort, settings, and the slash command", () => {
    const cmd = buildClaudeCommand(baseReq, "/state/settings/x.json");
    expect(cmd).toContain("claude --model 'opus' --effort 'high'");
    expect(cmd).toContain("--settings '/state/settings/x.json'");
    expect(cmd).toContain("'/lime-next RIC-46'");
  });

  it("invokes the stage skill matching the launch status", () => {
    expect(buildClaudeCommand({ ...baseReq, status: "Backlog" }, "/s/x.json")).toContain("'/lime-design RIC-46'");
    expect(buildClaudeCommand({ ...baseReq, status: "To Code" }, "/s/x.json")).toContain("'/lime-implement RIC-46'");
    expect(buildClaudeCommand({ ...baseReq, status: "To Review" }, "/s/x.json")).toContain("'/lime-review RIC-46'");
    // The route whitelists trailingArg to local|mr, so a To QA launch is always bare —
    // QA verdicts are resolved server-side without a session.
    expect(buildClaudeCommand({ ...baseReq, status: "To QA" }, "/s/x.json")).toContain("'/lime-qa RIC-46'");
    expect(buildClaudeCommand({ ...baseReq, status: "To Merge", trailingArg: "local" }, "/s/x.json"))
      .toContain("'/lime-merge RIC-46 local'");
  });

  it("appends a trailing gate arg inside the quoted slash command", () => {
    const cmd = buildClaudeCommand({ ...baseReq, trailingArg: "approve" }, "/s/x.json");
    expect(cmd).toContain("'/lime-next RIC-46 approve'");
  });

  it("appends the To Merge mode as the trailing gate arg", () => {
    expect(buildClaudeCommand({ ...baseReq, trailingArg: "local" }, "/s/x.json"))
      .toContain("'/lime-next RIC-46 local'");
    expect(buildClaudeCommand({ ...baseReq, trailingArg: "mr" }, "/s/x.json"))
      .toContain("'/lime-next RIC-46 mr'");
  });

  it("neutralizes shell metacharacters in model/effort", () => {
    const cmd = buildClaudeCommand({ ...baseReq, model: "opus; touch pwned" }, "/s/x.json");
    // the injection payload is contained inside a single-quoted token, not a live command
    expect(cmd).toContain("--model 'opus; touch pwned'");
    expect(cmd).not.toContain("; touch pwned "); // never appears unquoted/executable
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
    expect((res as { ok: true; meta: { kind: string } }).meta.kind).toBe("lime");
  });

  it("writes the hook settings file with owner-only permissions", async () => {
    const d = deps();
    const res = await launchSession(baseReq, d);
    expect(res.ok).toBe(true);
    const mode = statSync(join(dir, "settings", "mojito-RIC-46-planned.json")).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("prefixes LIME_SESSION_CONTEXT when a context path is given", () => {
    const cmd = buildClaudeCommand(baseReq, "/state/settings/x.json", "/state/context/x.json");
    expect(cmd).toMatch(/^LIME_SESSION_CONTEXT='\/state\/context\/x.json' claude /);
  });

  it("omits LIME_SESSION_CONTEXT when no context path is given", () => {
    const cmd = buildClaudeCommand(baseReq, "/state/settings/x.json");
    expect(cmd).not.toContain("LIME_SESSION_CONTEXT");
    expect(cmd.startsWith("claude ")).toBe(true);
  });

  it("writes the launch context file with owner-only permissions", async () => {
    const { readFileSync } = await import("node:fs");
    const d = deps();
    await launchSession(baseReq, d);
    const p = join(dir, "context", "mojito-RIC-46-planned.json");
    expect(statSync(p).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(p, "utf8"))).toEqual({
      identifier: "RIC-46", statusName: "Planned",
      title: "Auto-advance toggle", project: "Lime", labels: ["Feature"],
    });
  });

  it("records title and labels on the session meta", async () => {
    const d = deps();
    await launchSession(baseReq, d);
    const meta = d.registry.get("mojito-RIC-46-planned");
    expect(meta?.title).toBe("Auto-advance toggle");
    expect(meta?.labels).toEqual(["Feature"]);
  });
});

function customDeps(over: Record<string, unknown> = {}) {
  return {
    registry: new Registry(dir), stateDir: dir, port: 4711, token: "test-token",
    projectsPath: "/nope.json",
    hasSession: vi.fn(async () => false),
    newSession: vi.fn(async () => {}),
    pipePane: vi.fn(async () => {}),
    resolveCwd: () => "/code/Lime/mojito/.worktrees/ricventu/ric-128-x",
    nowIso: () => "2026-07-11T00:00:00.000Z",
    genId: () => "abc123",
    homeDir: () => "/home/me",
    shell: () => "/bin/zsh",
    ...over,
  };
}

describe("buildCustomClaudeCommand", () => {
  it("builds a bare claude command with no slash command", () => {
    const cmd = buildCustomClaudeCommand({ projectName: null, model: "opus", effort: "high" }, "/s/x.json");
    expect(cmd).toBe("claude --model 'opus' --effort 'high' --settings '/s/x.json'");
    expect(cmd).not.toContain("/lime-next");
  });

  it("prefixes LIME_SESSION_CONTEXT when a context path is given", () => {
    const cmd = buildCustomClaudeCommand({ projectName: null, model: "opus", effort: "high" },
      "/s/x.json", "/state/context/mojito-custom-ric-128-abc123.json");
    expect(cmd).toMatch(/^LIME_SESSION_CONTEXT='\/state\/context\/mojito-custom-ric-128-abc123.json' claude /);
    expect(cmd).not.toContain("/lime-next");
  });

  it("omits LIME_SESSION_CONTEXT when no context path is given", () => {
    const cmd = buildCustomClaudeCommand({ projectName: null, model: "opus", effort: "high" }, "/s/x.json");
    expect(cmd).not.toContain("LIME_SESSION_CONTEXT");
    expect(cmd.startsWith("claude ")).toBe(true);
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
      launchStatus: "", cwd: "/home/me", projectName: null, title: "home", autoAdvance: false });
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
});

describe("buildNewTicketClaudeCommand", () => {
  it("prefixes LIME_NEW_CONTEXT and runs /lime-new", () => {
    const cmd = buildNewTicketClaudeCommand(
      { projectName: null, model: "opus", effort: "high", brief: "x" },
      "/s/x.json",
      "/state/context/mojito-custom-general-abc123.json",
    );
    expect(cmd).toMatch(/^LIME_NEW_CONTEXT='\/state\/context\/mojito-custom-general-abc123.json' claude /);
    expect(cmd).toContain("--model 'opus' --effort 'high'");
    expect(cmd).toContain("--settings '/s/x.json'");
    expect(cmd).toContain("'/lime-new'");
    expect(cmd).not.toContain("/lime-next");
  });
});

const baseRebaseReq = {
  ticket: "RIC-120", projectName: "Mojito", title: "action per fare rebase",
  labels: [] as string[], model: "opus", effort: "xhigh" as const,
};

describe("buildRebaseClaudeCommand", () => {
  it("runs /lime-rebase for the ticket with a launch context prefix", () => {
    const cmd = buildRebaseClaudeCommand(baseRebaseReq, "/s/x.json", "/c/x.json");
    expect(cmd).toMatch(/^LIME_SESSION_CONTEXT='\/c\/x.json' claude /);
    expect(cmd).toContain("--model 'opus' --effort 'xhigh'");
    expect(cmd).toContain("--settings '/s/x.json'");
    expect(cmd).toContain("'/lime-rebase RIC-120'");
    expect(cmd).not.toContain("/lime-next");
  });
});

describe("launchNewTicketSession", () => {
  it("General opens in the home directory with a New ticket · home title", async () => {
    const d = customDeps();
    const res = await launchNewTicketSession(
      { brief: "Aggiungi export CSV", projectName: null, model: "opus", effort: "high" }, d,
    );
    expect(res.ok).toBe(true);
    const meta = (res as { ok: true; meta: SessionMeta }).meta;
    expect(meta).toMatchObject({
      kind: "custom", id: "mojito-custom-new-ticket-abc123", ticket: "", launchStatus: "",
      cwd: "/home/me", projectName: null, title: "New ticket · home", autoAdvance: false,
    });
    expect(d.newSession).toHaveBeenCalledWith(
      "mojito-custom-new-ticket-abc123", "/home/me",
      expect.stringContaining("'/lime-new'"),
    );
  });

  it("a mapped project opens in its folder with the project in the title", async () => {
    const projectsPath = join(dir, "projects.json");
    writeFileSync(projectsPath, JSON.stringify({ RIC: { projects: { Mojito: "/code/Lime/mojito" } } }));
    const d = customDeps({ projectsPath });
    const res = await launchNewTicketSession(
      { brief: "x", projectName: "Mojito", model: "sonnet", effort: "low" }, d,
    );
    expect(res.ok).toBe(true);
    const meta = (res as { ok: true; meta: SessionMeta }).meta;
    expect(meta).toMatchObject({
      kind: "custom", id: "mojito-custom-mojito-abc123", cwd: "/code/Lime/mojito",
      projectName: "Mojito", title: "New ticket · Mojito",
    });
  });

  it("writes the LIME_NEW_CONTEXT file with the brief and project", async () => {
    const projectsPath = join(dir, "projects.json");
    writeFileSync(projectsPath, JSON.stringify({ RIC: { projects: { Mojito: "/code/Lime/mojito" } } }));
    const d = customDeps({ projectsPath });
    await launchNewTicketSession({ brief: "Aggiungi export CSV", projectName: "Mojito", model: "opus", effort: "high" }, d);
    const p = join(dir, "context", "mojito-custom-mojito-abc123.json");
    expect(JSON.parse(readFileSync(p, "utf8"))).toEqual({ brief: "Aggiungi export CSV", project: "Mojito", images: [] });
  });

  it("writes provided image URLs into the context", async () => {
    const projectsPath = join(dir, "projects.json");
    writeFileSync(projectsPath, JSON.stringify({ RIC: { projects: { Mojito: "/code/Lime/mojito" } } }));
    const d = customDeps({ projectsPath });
    await launchNewTicketSession(
      { brief: "x", projectName: "Mojito", model: "opus", effort: "high", images: ["https://uploads.linear.app/a.png"] },
      d,
    );
    const p = join(dir, "context", "mojito-custom-mojito-abc123.json");
    expect(JSON.parse(readFileSync(p, "utf8")).images).toEqual(["https://uploads.linear.app/a.png"]);
  });

  it("refuses an unmapped project", async () => {
    const d = customDeps();
    const res = await launchNewTicketSession({ brief: "x", projectName: "Ghost", model: "opus", effort: "high" }, d);
    expect(res).toMatchObject({ ok: false, reason: "no-repo" });
  });
});

describe("launchRebaseSession", () => {
  it("launches a rebase-kind session with autoAdvance off at To QA", async () => {
    const d = deps();
    const res = await launchRebaseSession(baseRebaseReq, d);
    expect(res.ok).toBe(true);
    const meta = (res as { ok: true; meta: SessionMeta }).meta;
    expect(meta).toMatchObject({
      kind: "rebase", id: "mojito-RIC-120-rebase", ticket: "RIC-120",
      launchStatus: "To QA", autoAdvance: false, state: "starting", cwd: "/code/lime",
    });
    expect(d.newSession).toHaveBeenCalledWith(
      "mojito-RIC-120-rebase", "/code/lime", expect.stringContaining("'/lime-rebase RIC-120'"));
  });

  it("writes a launch context with statusName To QA", async () => {
    const { readFileSync } = await import("node:fs");
    const d = deps();
    await launchRebaseSession(baseRebaseReq, d);
    const p = join(dir, "context", "mojito-RIC-120-rebase.json");
    expect(JSON.parse(readFileSync(p, "utf8"))).toEqual({
      identifier: "RIC-120", statusName: "To QA",
      title: "action per fare rebase", project: "Mojito", labels: [],
    });
  });

  it("refuses a duplicate", async () => {
    const d = deps({ hasSession: vi.fn(async () => true) });
    const res = await launchRebaseSession(baseRebaseReq, d);
    expect(res).toMatchObject({ ok: false, reason: "duplicate", id: "mojito-RIC-120-rebase" });
  });

  it("refuses when no repo resolves", async () => {
    const d = deps({ resolveCwd: () => null });
    const res = await launchRebaseSession(baseRebaseReq, d);
    expect(res).toMatchObject({ ok: false, reason: "no-repo" });
  });
});

describe("launchCustomSession from a ticket (RIC-128)", () => {
  const ticketReq = { projectName: "Mojito", model: "opus", effort: "high" as const,
    ticket: "RIC-128", status: "Todo", title: "Custom session from a ticket", labels: ["Feature"] };

  it("opens in the ticket's worktree and carries ticket/title/labels on the meta", async () => {
    const d = customDeps({ resolveCwd: () => "/wt/ric-128" });
    const res = await launchCustomSession(ticketReq, d);
    expect(res.ok).toBe(true);
    const meta = (res as { ok: true; meta: SessionMeta }).meta;
    expect(meta).toMatchObject({ kind: "custom", id: "mojito-custom-ric-128-abc123",
      ticket: "RIC-128", launchStatus: "", cwd: "/wt/ric-128", projectName: "Mojito",
      title: "Custom session from a ticket", labels: ["Feature"], autoAdvance: false });
  });

  it("writes a launch-context file and prefixes LIME_SESSION_CONTEXT (no /lime-next)", async () => {
    const { readFileSync } = await import("node:fs");
    const d = customDeps({ resolveCwd: () => "/wt/ric-128" });
    await launchCustomSession(ticketReq, d);
    const p = join(dir, "context", "mojito-custom-ric-128-abc123.json");
    expect(statSync(p).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(p, "utf8"))).toEqual({
      identifier: "RIC-128", statusName: "Todo",
      title: "Custom session from a ticket", project: "Mojito", labels: ["Feature"],
    });
    expect(d.newSession).toHaveBeenCalledWith("mojito-custom-ric-128-abc123", "/wt/ric-128",
      expect.stringMatching(/^LIME_SESSION_CONTEXT='[^']+' claude /));
    expect(d.newSession).toHaveBeenCalledWith("mojito-custom-ric-128-abc123", "/wt/ric-128",
      expect.not.stringContaining("/lime-next"));
  });

  it("falls back to the repo root when no worktree exists", async () => {
    const d = customDeps({ resolveCwd: () => "/code/Lime/mojito" });
    const res = await launchCustomSession(ticketReq, d);
    expect(res.ok).toBe(true);
    expect((res as { ok: true; meta: SessionMeta }).meta.cwd).toBe("/code/Lime/mojito");
  });

  it("refuses when the ticket's team/project is unmapped", async () => {
    const d = customDeps({ resolveCwd: () => null });
    const res = await launchCustomSession(ticketReq, d);
    expect(res).toMatchObject({ ok: false, reason: "no-repo" });
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
      launchStatus: "", cwd: "/home/me", projectName: null, title: "home", autoAdvance: false,
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
    const d = customDeps({ resolveCwd: () => "/wt/ric-155" });
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
    }
    // Command carries the seeded prompt as the final quoted arg, and no client string.
    expect(command).toMatch(/claude --model .* --effort .* --settings .* '.*force-push.*'/s);
  });
});
