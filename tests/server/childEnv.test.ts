import { describe, it, expect, beforeEach } from "vitest";
import {
  sanitizeEnv,
  sanitizePath,
  tmuxEnvArgs,
  registerMojitoOnlyKeys,
  registerEnvFileKeys,
  registerEnvKeysAddedSince,
  resetMojitoOnlyKeys,
  snapshotEnvKeys,
  type EnvLike,
} from "@/server/childEnv";

// A realistic slice of what `npm start` hands Mojito's server process, and therefore
// what every tmux session used to inherit (see RIC-207).
const NPM_PATH = [
  "/Users/me/code/Mojito/mojito/node_modules/.bin",
  "/Users/me/code/Mojito/node_modules/.bin",
  "/Users/me/code/node_modules/.bin",
  "/Users/me/node_modules/.bin",
  "/Users/node_modules/.bin",
  "/node_modules/.bin",
  "/Users/me/.nvm/versions/node/v22.22.0/lib/node_modules/npm/node_modules/@npmcli/run-script/lib/node-gyp-bin",
  "/opt/homebrew/bin",
  "/usr/bin",
  "/bin",
].join(":");

const CLEAN_PATH = ["/opt/homebrew/bin", "/usr/bin", "/bin"].join(":");

const POLLUTED = {
  HOME: "/Users/me",
  SHELL: "/bin/zsh",
  PATH: NPM_PATH,
  NODE_ENV: "production",
  NODE: "/Users/me/.nvm/versions/node/v22.22.0/bin/node",
  INIT_CWD: "/Users/me/code/Mojito/mojito",
  _: "/usr/bin/env",
  npm_command: "start",
  npm_config_local_prefix: "/Users/me/code/Mojito/mojito",
  npm_lifecycle_script: "cross-env NODE_ENV=production tsx server.ts",
  __NEXT_PROCESSED_ENV: "true",
  MOJITO_TOKEN: "s3cret",
  MOJITO_PORT: "4711",
  LINEAR_API_KEY: "lin_api_deadbeef",
  TURBOPACK: "auto",
};

beforeEach(() => {
  resetMojitoOnlyKeys();
});

describe("sanitizeEnv", () => {
  it("drops NODE_ENV, so a session's package manager never runs in production mode", () => {
    expect(sanitizeEnv(POLLUTED)).not.toHaveProperty("NODE_ENV");
  });

  it("drops npm's own run-script variables", () => {
    const clean = sanitizeEnv(POLLUTED);
    expect(clean).not.toHaveProperty("npm_command");
    expect(clean).not.toHaveProperty("npm_config_local_prefix");
    expect(clean).not.toHaveProperty("npm_lifecycle_script");
    expect(clean).not.toHaveProperty("NODE");
    expect(clean).not.toHaveProperty("INIT_CWD");
    expect(clean).not.toHaveProperty("_");
  });

  it("drops Mojito's own config and the Linear credential", () => {
    const clean = sanitizeEnv(POLLUTED);
    expect(clean).not.toHaveProperty("MOJITO_TOKEN");
    expect(clean).not.toHaveProperty("MOJITO_PORT");
    expect(clean).not.toHaveProperty("LINEAR_API_KEY");
    expect(clean).not.toHaveProperty("__NEXT_PROCESSED_ENV");
  });

  it("keeps the rest of the user's environment untouched", () => {
    const clean = sanitizeEnv(POLLUTED);
    expect(clean.HOME).toBe("/Users/me");
    expect(clean.SHELL).toBe("/bin/zsh");
  });

  it("keeps PATH but strips npm's injected prefix", () => {
    expect(sanitizeEnv(POLLUTED).PATH).toBe(CLEAN_PATH);
  });

  it("drops keys registered as leaked by the .env loader", () => {
    registerMojitoOnlyKeys(["SOME_FUTURE_SECRET"]);
    expect(sanitizeEnv({ ...POLLUTED, SOME_FUTURE_SECRET: "x" })).not.toHaveProperty("SOME_FUTURE_SECRET");
  });

  it("skips undefined values rather than stringifying them", () => {
    expect(sanitizeEnv({ HOME: "/Users/me", NOPE: undefined })).toEqual({ HOME: "/Users/me" });
  });

  // RIC-246: `next()` writes TURBOPACK into Mojito's own process at boot, and every one of
  // these is read by *any* repo's `next` command to pick a bundler. Leaked, they either
  // override that repo's choice or collide with it — `pnpm dev --webpack` in a session
  // exits 1 with "Multiple bundler flags set: TURBOPACK=1, --webpack".
  it("drops Next's bundler-selection variables, whatever value they carry", () => {
    const env = {
      TURBOPACK: "auto",
      NEXT_RSPACK: "1",
      IS_TURBOPACK_TEST: "1",
      IS_WEBPACK_TEST: "1",
      NEXT_TEST_USE_RSPACK: "1",
      HOME: "/Users/me",
    };
    expect(sanitizeEnv(env)).toEqual({ HOME: "/Users/me" });
  });

  // Not a blanket NEXT_ prefix: NEXT_TELEMETRY_DISABLED is a preference the user sets for
  // themselves, and dropping it would turn telemetry back on inside every session.
  it("keeps the user's own NEXT_ preferences", () => {
    expect(sanitizeEnv({ NEXT_TELEMETRY_DISABLED: "1" })).toEqual({ NEXT_TELEMETRY_DISABLED: "1" });
  });
});

// Nobody has to remember to extend a list when .env.local grows a key: the .env loader's own
// additions to process.env are what gets registered.
describe("registerEnvFileKeys", () => {
  it("scrubs whatever the .env loader added to the environment", () => {
    const env: EnvLike = { HOME: "/Users/me" };
    registerEnvFileKeys(() => { env.SOME_NEW_TOKEN = "s3cret"; }, env);
    expect(sanitizeEnv(env)).toEqual({ HOME: "/Users/me" });
  });

  it("leaves a variable the user exported in their own shell alone", () => {
    // dotenv semantics: an already-set variable is not overwritten, so it is the user's
    // environment, inherited exactly as it would be by any process they start themselves.
    const env: EnvLike = { HOME: "/Users/me", MY_TOKEN: "from-shell" };
    registerEnvFileKeys(() => {}, env);
    expect(sanitizeEnv(env).MY_TOKEN).toBe("from-shell");
  });
});

// The .env loader runs at boot, but Next mutates process.env later still — `next()` sets
// TURBOPACK, and constructing the server sets NEXT_DEPLOYMENT_ID. Same diffing trick,
// spanning statements instead of wrapping one call, because those two sit either side of
// an await in server.ts (RIC-246).
describe("snapshotEnvKeys / registerEnvKeysAddedSince", () => {
  it("scrubs whatever Next added to the environment between the two calls", () => {
    const env: EnvLike = { HOME: "/Users/me" };
    const before = snapshotEnvKeys(env);
    env.NEXT_DEPLOYMENT_ID = "";
    registerEnvKeysAddedSince(before, env);
    expect(sanitizeEnv(env)).toEqual({ HOME: "/Users/me" });
  });

  it("leaves a variable that was already there alone, even if Next rewrote its value", () => {
    const env: EnvLike = { HOME: "/Users/me", MY_TOKEN: "from-shell" };
    const before = snapshotEnvKeys(env);
    env.MY_TOKEN = "rewritten";
    registerEnvKeysAddedSince(before, env);
    expect(sanitizeEnv(env).MY_TOKEN).toBe("rewritten");
  });

  // A snapshot is a copy, not a live view of the same object.
  it("is not fooled by the environment it snapshotted being mutated in place", () => {
    const env: EnvLike = { HOME: "/Users/me" };
    const before = snapshotEnvKeys(env);
    env.LATE = "x";
    expect(before.has("LATE")).toBe(false);
  });
});

describe("sanitizePath", () => {
  it("removes the node_modules/.bin chain npm prepends for the package and its ancestors", () => {
    expect(sanitizePath(NPM_PATH, "/Users/me/code/Mojito/mojito")).toBe(CLEAN_PATH);
  });

  it("leaves a PATH npm never touched alone", () => {
    expect(sanitizePath(CLEAN_PATH, "/Users/me/code/Mojito/mojito")).toBe(CLEAN_PATH);
  });

  // Anchoring on npm's own local prefix is what makes this safe: a node_modules/.bin the
  // user's profile put on PATH for an unrelated project is theirs, not npm's injection.
  it("keeps a node_modules/.bin outside the package's ancestor chain", () => {
    const path = ["/Users/me/other/node_modules/.bin", "/usr/bin"].join(":");
    expect(sanitizePath(path, "/Users/me/code/Mojito/mojito")).toBe(path);
  });

  it("changes nothing when npm's local prefix is unknown", () => {
    expect(sanitizePath(NPM_PATH, undefined)).toBe(NPM_PATH);
  });
});

describe("tmuxEnvArgs", () => {
  // The tmux server outlives Mojito and hands its *global* environment to every new
  // session, so a server that an older (leaking) Mojito started keeps leaking even after
  // Mojito's own spawn env is clean. Per-session -e overrides shadow that, session-scoped.
  it("overrides each leaking key that the tmux server's global environment carries", () => {
    const args = tmuxEnvArgs({ NODE_ENV: "production", LINEAR_API_KEY: "lin_api_x", HOME: "/Users/me" });
    expect(args).toContain("-e");
    expect(args).toContain("NODE_ENV=");
    expect(args).toContain("LINEAR_API_KEY=");
    expect(args).not.toContain("HOME=");
    expect(args).toHaveLength(4);
  });

  it("replaces a globally polluted PATH with the sanitized one", () => {
    const args = tmuxEnvArgs({ PATH: NPM_PATH, npm_config_local_prefix: "/Users/me/code/Mojito/mojito" });
    expect(args).toContain(`PATH=${CLEAN_PATH}`);
  });

  it("leaves a clean global PATH alone rather than restating it", () => {
    const args = tmuxEnvArgs({ PATH: CLEAN_PATH, npm_config_local_prefix: "/Users/me/code/Mojito/mojito" });
    expect(args.some((a) => a.startsWith("PATH="))).toBe(false);
  });

  // The one case a boot-time diff can never catch: the value is already in Mojito's
  // environment before Mojito starts, because a Mojito session poisoned the tmux server's
  // global environment and Mojito was launched from one of its shells. An empty TURBOPACK
  // is as good as an absent one — every reader of it in Next is a plain truthiness check.
  it("shadows a TURBOPACK the tmux server's global environment already carries", () => {
    expect(tmuxEnvArgs({ TURBOPACK: "1", HOME: "/Users/me" })).toEqual(["-e", "TURBOPACK="]);
  });

  // Nothing to shadow means nothing to say: a clean tmux server must not get an empty
  // NODE_ENV bolted on, which is subtly different from the variable being absent.
  it("says nothing about a clean global environment", () => {
    expect(tmuxEnvArgs({ HOME: "/Users/me", PATH: CLEAN_PATH })).toEqual([]);
  });
});
