import { describe, it, expect, beforeEach } from "vitest";
import { newSession, parseGlobalEnvironment, outsideService, q, DuplicateSessionError, PREFIX } from "../../src/tmux/tmux";
import { resetMojitoOnlyKeys } from "../../src/env/childEnv";

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

describe("q", () => {
  it("single-quotes a plain value", () => {
    expect(q("abc def")).toBe("'abc def'");
  });

  it("closes, escapes and reopens around an apostrophe", () => {
    expect(q("it's")).toBe(`'it'\\''s'`);
  });
});

describe("PREFIX", () => {
  it("is mj-", () => {
    expect(PREFIX).toBe("mj-");
  });
});

// RIC-207: the shell of every agent session used to inherit Mojito's own NODE_ENV=production,
// under which a bare `pnpm install` deletes the workspace's devDependencies and exits 0.
describe("newSession environment", () => {
  it("spawns tmux with Mojito's own variables scrubbed", async () => {
    const rec = recorder();
    await newSession("mj-RIC-207", "/repo", "claude", {
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
    await newSession("mj-RIC-207", "/repo", "claude", {
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
    await newSession("mj-RIC-207", "/repo", "claude", {
      exec: rec.exec,
      globalEnv: async () => ({ HOME: "/Users/me" }),
      env: () => POLLUTED_PARENT,
    });
    expect(rec.calls[0].args).not.toContain("-e");
  });

  it("still creates the session with its cwd, command and status line off", async () => {
    const rec = recorder();
    await newSession("mj-RIC-207", "/repo", "claude --model opus", {
      exec: rec.exec,
      globalEnv: async () => ({}),
      env: () => POLLUTED_PARENT,
    });
    expect(rec.calls[0].args).toEqual([
      "new-session", "-d", "-s", "mj-RIC-207", "-c", "/repo", "claude --model opus",
      ";", "set-option", "-t", "=mj-RIC-207:", "status", "off",
    ]);
  });
});

describe("newSession duplicates", () => {
  it("turns tmux's 'duplicate session' stderr into a DuplicateSessionError", async () => {
    const failing = async () => {
      throw Object.assign(new Error("Command failed"), { stderr: "duplicate session: mj-RIC-1\n" });
    };
    const attempt = newSession("mj-RIC-1", "/repo", "claude", {
      exec: failing,
      globalEnv: async () => ({}),
      env: () => POLLUTED_PARENT,
    });
    await expect(attempt).rejects.toBeInstanceOf(DuplicateSessionError);
    await expect(attempt).rejects.toThrow(/mj-RIC-1/);
  });

  it("lets any other tmux failure through unchanged", async () => {
    const boom = new Error("no server running");
    await expect(
      newSession("mj-RIC-1", "/repo", "claude", {
        exec: async () => { throw boom; },
        globalEnv: async () => ({}),
        env: () => POLLUTED_PARENT,
      }),
    ).rejects.toBe(boom);
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

// Under systemd (the Linux box), a tmux server started from mojito.service's cgroup died with
// every restart of the service, taking every session with it.
describe("tmux server outside the systemd service", () => {
  const UNDER_SYSTEMD = { ...POLLUTED_PARENT, INVOCATION_ID: "abc123" };

  it("starts the session in a scope of its own when Mojito runs as a systemd service", async () => {
    const rec = recorder();
    await newSession("mj-RIC-1", "/repo", "claude", {
      exec: rec.exec,
      globalEnv: async () => ({}),
      env: () => UNDER_SYSTEMD,
    });
    expect(rec.calls[0].file).toBe("systemd-run");
    expect(rec.calls[0].args.slice(0, 6)).toEqual([
      "--user", "--scope", "--quiet", "--description=Mojito tmux", "tmux", "new-session",
    ]);
  });

  it("runs tmux directly anywhere else", () => {
    expect(outsideService(["new-session"], POLLUTED_PARENT)).toEqual(["tmux", ["new-session"]]);
  });
});
