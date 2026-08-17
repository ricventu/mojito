import { dirname, join } from "node:path";

/**
 * Mojito's own process environment is not a neutral base for the things it spawns.
 * `npm start` runs `cross-env NODE_ENV=production tsx server.ts`, so the server carries
 * `NODE_ENV=production`, npm's whole `npm_*` block, and a PATH prefixed with the
 * `node_modules/.bin` chain of Mojito's own repo; `loadEnvConfig` then adds Mojito's
 * `.env.local` on top, credentials included. Every one of those used to reach the shell of
 * every agent session, because a tmux session inherits the environment of whoever started
 * the tmux server (RIC-207).
 *
 * The damage is silent and destructive rather than cosmetic: with `NODE_ENV=production` a
 * bare `pnpm install` skips devDependencies *and removes the ones already installed*,
 * printing them with a `-` prefix and exiting 0. It reads as a successful install while
 * `node_modules/.bin` is emptied out. `npm ci` and `yarn install` have the same hazard, and
 * the leading PATH entries shadow a workspace's own binaries with Mojito's.
 *
 * So: everything Mojito spawns on a session's behalf — the tmux sessions, the pty that
 * attaches to them, a repo's own `scripts/init-worktree.sh` — gets its environment from
 * here instead of straight from `process.env`.
 */

// `process.env`, structurally. Next's type augmentation makes NODE_ENV a *required* member
// of NodeJS.ProcessEnv, which a sanitized environment by definition does not have — so the
// looser shape is the one this module can honestly speak in.
export type EnvLike = Record<string, string | undefined>;

// Whole families that only ever describe how Mojito itself was started.
const DROP_PREFIXES = [
  "npm_", // npm run-script's own block (npm_config_*, npm_package_*, npm_lifecycle_*, ...)
  "MOJITO_", // Mojito's port, auth token, state dir: config for the server, noise for a session
];

const DROP_EXACT = new Set([
  "NODE_ENV", // the headline of RIC-207
  "NODE", // npm points this at the node binary that ran Mojito, not the workspace's
  "INIT_CWD", // npm's record of where `npm start` was invoked
  "_", // the invoking shell's "last argv[0]"; every shell resets it anyway
  "__NEXT_PROCESSED_ENV", // marker left by @next/env after it loaded Mojito's .env files
  "LINEAR_API_KEY", // Mojito is the only Linear client; a session has no business holding it
]);

// Keys that reached process.env from Mojito's .env files at boot. Registered by server.ts
// (it diffs process.env across loadEnvConfig) so a key added to .env.local later is scrubbed
// without anyone having to remember this list. Vars the user exported in their own shell are
// deliberately NOT in here: those are their environment, inherited as they would be anywhere.
let mojitoOnlyKeys = new Set<string>();

export function registerMojitoOnlyKeys(keys: Iterable<string>): void {
  for (const k of keys) mojitoOnlyKeys.add(k);
}

// Tests only: the registry is process-global, so each case starts from a known state.
export function resetMojitoOnlyKeys(): void {
  mojitoOnlyKeys = new Set<string>();
}

/**
 * Runs the .env loader and registers whatever it added to the environment. Diffing beats
 * naming the keys: `.env.local` gaining a credential later is scrubbed without anyone
 * remembering this file. Variables the user had already exported are untouched by dotenv
 * semantics and so never show up in the diff — those are their environment, not Mojito's.
 */
export function registerEnvFileKeys(load: () => void, env: EnvLike = process.env): void {
  const before = new Set(Object.keys(env));
  load();
  registerMojitoOnlyKeys(Object.keys(env).filter((k) => !before.has(k)));
}

function isMojitoOnly(key: string): boolean {
  return DROP_EXACT.has(key) || mojitoOnlyKeys.has(key) || DROP_PREFIXES.some((p) => key.startsWith(p));
}

/**
 * PATH with npm's injected prefix removed. `npm run` prepends `<dir>/node_modules/.bin`
 * for the package directory and every one of its ancestors, plus its own node-gyp shim
 * directory. Anchoring on npm's `npm_config_local_prefix` (the package root) is what keeps
 * this safe: a `node_modules/.bin` the user's profile put on PATH for some other project
 * doesn't match the chain and stays. With no local prefix to anchor on, npm never ran, so
 * there is nothing to strip.
 */
export function sanitizePath(pathValue: string, localPrefix: string | undefined): string {
  if (!localPrefix) return pathValue;
  const injected = new Set<string>();
  for (let dir = localPrefix; ; dir = dirname(dir)) {
    injected.add(join(dir, "node_modules", ".bin"));
    if (dirname(dir) === dir) break;
  }
  return pathValue
    .split(":")
    .filter((entry) => !injected.has(entry) && !entry.endsWith("/node-gyp-bin"))
    .join(":");
}

/** `env` with every Mojito-only variable removed and PATH un-prefixed. */
export function sanitizeEnv(env: EnvLike): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || isMojitoOnly(key)) continue;
    out[key] = key === "PATH" ? sanitizePath(value, env.npm_config_local_prefix) : value;
  }
  return out;
}

/**
 * `-e` arguments for `tmux new-session`, shadowing whatever the tmux *server's* global
 * environment still leaks. That second layer is needed because the tmux server outlives
 * Mojito: one started by a pre-fix Mojito holds `NODE_ENV=production` in its global
 * environment and hands it to every session created afterwards, however clean the client's
 * own environment is. The overrides are session-scoped, so the user's own tmux sessions are
 * never touched.
 *
 * Only what is actually leaking gets an override. A clean global environment gets no `-e`
 * at all, which leaves the variables genuinely absent — `-e NODE_ENV=` would instead pin an
 * empty string, close enough for a package manager but not the same thing.
 */
export function tmuxEnvArgs(globalEnv: Record<string, string>): string[] {
  const args: string[] = [];
  for (const [key, value] of Object.entries(globalEnv)) {
    if (key === "PATH") {
      const clean = sanitizePath(value, globalEnv.npm_config_local_prefix);
      if (clean !== value) args.push("-e", `PATH=${clean}`);
      continue;
    }
    // tmux's -e needs a value, so a leaking key is emptied rather than unset.
    if (isMojitoOnly(key)) args.push("-e", `${key}=`);
  }
  return args;
}

/**
 * `sanitizeEnv` in the shape child_process wants. The cast is the honest direction: an
 * environment with no NODE_ENV cannot satisfy Next's NODE_ENV-required `ProcessEnv`, and
 * having no NODE_ENV is the entire point.
 */
export function spawnEnv(env: EnvLike = process.env): NodeJS.ProcessEnv {
  return sanitizeEnv(env) as NodeJS.ProcessEnv;
}
