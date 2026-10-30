import { dirname, join } from "node:path";

/**
 * Mojito's own process environment is not a neutral base for the things it spawns. The
 * service runs `pnpm start`, so the server carries the package manager's run-script block
 * (`npm_*`, `INIT_CWD`, `NODE`) and a PATH prefixed with the `node_modules/.bin` chain of
 * Mojito's own repo; `loadEnvFile` (config.ts) then adds Mojito's `.env.local` on top,
 * credentials included. Every one of those would reach the shell of every agent session,
 * because a tmux session inherits the environment of whoever started the tmux server.
 *
 * The damage is silent and destructive rather than cosmetic (RIC-207, from the old app,
 * which ran under `NODE_ENV=production`): with that set, a bare `pnpm install` skips
 * devDependencies *and removes the ones already installed*, printing them with a `-` prefix
 * and exiting 0. It reads as a successful install while `node_modules/.bin` is emptied out.
 * `npm ci` and `yarn install` have the same hazard, and the leading PATH entries shadow a
 * workspace's own binaries with Mojito's.
 *
 * So: everything Mojito spawns — the tmux sessions, the pty that attaches to them, git, the
 * Agent SDK's claude — gets its environment from here instead of straight from `process.env`.
 */

// `process.env`, structurally: a plain record of what may or may not be set.
export type EnvLike = Record<string, string | undefined>;

// Whole families that only ever describe how Mojito itself was started.
const DROP_PREFIXES = [
  "npm_", // the run-script block npm and pnpm set (npm_config_*, npm_lifecycle_*, ...)
  "pnpm_", // pnpm's config for the run; case-sensitive, so the user's PNPM_HOME stays
  "MOJITO_", // Mojito's port, host, auth token, state dir: config for the server, noise for a session
];

const DROP_EXACT = new Set([
  "NODE_ENV", // the headline of RIC-207
  "NODE", // the package manager points this at the binary that ran Mojito, not the workspace's
  "INIT_CWD", // the package manager's record of where `pnpm start` was invoked
  "PNPM_SCRIPT_SRC_DIR", // pnpm's record of the package whose script runs Mojito
  "_", // the invoking shell's "last argv[0]"; every shell resets it anyway
  "__NEXT_PROCESSED_ENV", // the old app's @next/env marker; a shell it started may carry it
  "LINEAR_API_KEY", // Mojito is the only Linear client; a session has no business holding it
  // Next's bundler-selection variables (RIC-246). The old app's `next()` wrote TURBOPACK into
  // its own process, and these are the exact keys any repo's `next` command consults to pick
  // a bundler (`getBundlerFromEnv`, `parseBundlerArgs`). Leaked, they either override that
  // repo's choice or collide with it outright: a session running `pnpm dev --webpack` exits 1
  // with "Multiple bundler flags set: TURBOPACK=1, --webpack". Dropped unconditionally, unlike
  // the .env keys below, because a value already present when Mojito boots is exactly the case
  // that self-perpetuates — Mojito started from the shell of a session that inherited it hands
  // it on. A bundler is per-project by definition anyway, so even a hand-exported one has no
  // business deciding for a repo that never asked.
  "TURBOPACK",
  "NEXT_RSPACK",
  "IS_TURBOPACK_TEST",
  "IS_WEBPACK_TEST",
  "NEXT_TEST_USE_RSPACK",
]);

// Keys that reached process.env from Mojito's .env file at boot. Registered by config.ts's
// `loadEnvFile` (it diffs process.env across the load), so a key added to .env.local later is
// scrubbed without anyone having to remember this list. Vars the user exported in their own
// shell are deliberately NOT in here: those are their environment, inherited as they would be
// anywhere.
let mojitoOnlyKeys = new Set<string>();

export function registerMojitoOnlyKeys(keys: Iterable<string>): void {
  for (const k of keys) mojitoOnlyKeys.add(k);
}

// Tests only: the registry is process-global, so each case starts from a known state.
export function resetMojitoOnlyKeys(): void {
  mojitoOnlyKeys = new Set<string>();
}

/** The keys `env` holds right now, as a copy — the `before` half of a diff. */
export function snapshotEnvKeys(env: EnvLike = process.env): Set<string> {
  return new Set(Object.keys(env));
}

/**
 * Registers every key `env` has gained since the snapshot as Mojito's own. Diffing beats
 * naming keys: whatever Mojito's boot pulls in next is scrubbed without anyone remembering
 * this file. Only *new* keys count — a variable the user exported themselves is their
 * environment even if something rewrote its value along the way.
 */
export function registerEnvKeysAddedSince(before: Set<string>, env: EnvLike = process.env): void {
  registerMojitoOnlyKeys(Object.keys(env).filter((k) => !before.has(k)));
}

/**
 * Runs the .env loader and registers whatever it added to the environment, so `.env.local`
 * gaining a credential later needs no edit here. Variables the user had already exported
 * are untouched by dotenv semantics and so never show up in the diff — those are their
 * environment, not Mojito's.
 */
export function registerEnvFileKeys(load: () => void, env: EnvLike = process.env): void {
  const before = snapshotEnvKeys(env);
  load();
  registerEnvKeysAddedSince(before, env);
}

function isMojitoOnly(key: string): boolean {
  return DROP_EXACT.has(key) || mojitoOnlyKeys.has(key) || DROP_PREFIXES.some((p) => key.startsWith(p));
}

/**
 * Where a package manager's run-script started: npm's `npm_config_local_prefix`, else pnpm's
 * `PNPM_SCRIPT_SRC_DIR` (pnpm sets no local prefix). Undefined when neither ran Mojito.
 */
export function scriptDir(env: EnvLike): string | undefined {
  return env.npm_config_local_prefix || env.PNPM_SCRIPT_SRC_DIR || undefined;
}

/**
 * PATH with the package manager's injected prefix removed. `npm run` prepends
 * `<dir>/node_modules/.bin` for the package directory and every one of its ancestors, pnpm
 * the package's and the workspace root's; both add their own node-gyp shim directory.
 * Anchoring on the script's directory (`scriptDir`) is what keeps this safe: a
 * `node_modules/.bin` the user's profile put on PATH for some other project doesn't match the
 * chain and stays. With no directory to anchor on, no package manager ran, so there is
 * nothing to strip.
 */
export function sanitizePath(pathValue: string, scriptDir: string | undefined): string {
  if (!scriptDir) return pathValue;
  const injected = new Set<string>();
  for (let dir = scriptDir; ; dir = dirname(dir)) {
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
    out[key] = key === "PATH" ? sanitizePath(value, scriptDir(env)) : value;
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
      const clean = sanitizePath(value, scriptDir(globalEnv));
      if (clean !== value) args.push("-e", `PATH=${clean}`);
      continue;
    }
    // tmux's -e needs a value, so a leaking key is emptied rather than unset.
    if (isMojitoOnly(key)) args.push("-e", `${key}=`);
  }
  return args;
}

/** `sanitizeEnv` in the shape child_process wants. */
export function spawnEnv(env: EnvLike = process.env): NodeJS.ProcessEnv {
  return sanitizeEnv(env) as NodeJS.ProcessEnv;
}
