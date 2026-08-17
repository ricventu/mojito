import { describe, it, expect, beforeEach } from "vitest";
import { newSession, startStackSession, parseGlobalEnvironment } from "@/server/tmux";
import { resetMojitoOnlyKeys } from "@/server/childEnv";

function recorder() {
  const calls: { file: string; args: string[]; opts: { env: NodeJS.ProcessEnv } }[] = [];
  return {
    calls,
    exec: async (file: string, args: string[], opts: { env: NodeJS.ProcessEnv }) => {
      calls.push({ file, args, opts });
      return { stdout: "", stderr: "" };
    },
  };
}

const POLLUTED_PARENT = {
  HOME: "/Users/me",
  PATH: "/Users/me/code/Mojito/mojito/node_modules/.bin:/usr/bin",
  NODE_ENV: "production",
  npm_config_local_prefix: "/Users/me/code/Mojito/mojito",
  LINEAR_API_KEY: "lin_api_x",
};

beforeEach(() => {
  resetMojitoOnlyKeys();
});

// RIC-207: the shell of every agent session used to inherit Mojito's own NODE_ENV=production,
// under which a bare `pnpm install` deletes the workspace's devDependencies and exits 0.
describe("newSession environment", () => {
  it("spawns tmux with Mojito's own variables scrubbed", async () => {
    const rec = recorder();
    await newSession("mojito-RIC-207-work", "/repo", "claude", {
      exec: rec.exec,
      globalEnv: async () => ({}),
      env: () => POLLUTED_PARENT,
    });
    const env = rec.calls[0].opts.env!;
    expect(env).not.toHaveProperty("NODE_ENV");
    expect(env).not.toHaveProperty("LINEAR_API_KEY");
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/Users/me");
  });

  it("shadows what a tmux server started by an older Mojito still leaks globally", async () => {
    const rec = recorder();
    await newSession("mojito-RIC-207-work", "/repo", "claude", {
      exec: rec.exec,
      globalEnv: async () => ({ NODE_ENV: "production" }),
      env: () => POLLUTED_PARENT,
    });
    const args = rec.calls[0].args;
    expect(args).toContain("NODE_ENV=");
    // The override has to reach new-session itself; a later set-environment would come too
    // late for the pane new-session already spawned.
    expect(args.indexOf("NODE_ENV=")).toBeLessThan(args.indexOf(";"));
  });

  it("adds no override when the tmux server's global environment is already clean", async () => {
    const rec = recorder();
    await newSession("mojito-RIC-207-work", "/repo", "claude", {
      exec: rec.exec,
      globalEnv: async () => ({ HOME: "/Users/me" }),
      env: () => POLLUTED_PARENT,
    });
    expect(rec.calls[0].args).not.toContain("-e");
  });

  it("still creates the session with its cwd, command and status line off", async () => {
    const rec = recorder();
    await newSession("mojito-RIC-207-work", "/repo", "claude --model opus", {
      exec: rec.exec,
      globalEnv: async () => ({}),
      env: () => POLLUTED_PARENT,
    });
    expect(rec.calls[0].args).toEqual([
      "new-session", "-d", "-s", "mojito-RIC-207-work", "-c", "/repo", "claude --model opus",
      ";", "set-option", "-t", "mojito-RIC-207-work", "status", "off",
    ]);
  });
});

// A stack runs the project's own dev servers; it has even less business seeing Mojito's
// NODE_ENV or credentials than an agent session does.
describe("startStackSession environment", () => {
  it("scrubs the same variables and keeps remain-on-exit", async () => {
    const rec = recorder();
    await startStackSession("mojito-stack-lime", "/repo", "./scripts/start.sh", {
      exec: rec.exec,
      globalEnv: async () => ({ NODE_ENV: "production" }),
      env: () => POLLUTED_PARENT,
    });
    expect(rec.calls[0].opts.env).not.toHaveProperty("NODE_ENV");
    expect(rec.calls[0].args).toContain("NODE_ENV=");
    expect(rec.calls[0].args).toContain("remain-on-exit");
  });
});

describe("parseGlobalEnvironment", () => {
  it("reads tmux show-environment output", () => {
    expect(parseGlobalEnvironment("NODE_ENV=production\nHOME=/Users/me\n")).toEqual({
      NODE_ENV: "production",
      HOME: "/Users/me",
    });
  });

  it("keeps a value containing '=' whole", () => {
    expect(parseGlobalEnvironment("npm_lifecycle_script=cross-env NODE_ENV=production tsx server.ts\n"))
      .toEqual({ npm_lifecycle_script: "cross-env NODE_ENV=production tsx server.ts" });
  });

  // tmux marks a variable it has been told to unset with a leading "-": it is not set,
  // so it must not come back as a key that looks like it is.
  it("ignores variables tmux reports as unset", () => {
    expect(parseGlobalEnvironment("-NODE_ENV\nHOME=/Users/me\n")).toEqual({ HOME: "/Users/me" });
  });
});
