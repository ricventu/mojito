import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchSession, buildClaudeCommand } from "@/server/launch";
import { Registry } from "@/server/registry";

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
