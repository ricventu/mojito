/**
 * A deploy replaces the hashed chunks in `dist/assets`, so a page loaded before it asks for a
 * lazy chunk (the terminal, which carries xterm) that no longer exists, and the import rejects.
 * The cure is a reload, which fetches the new index.html and its new chunk names — once: a
 * chunk that still fails after a fresh load is a real failure, and reloading again would loop.
 */

/** sessionStorage key: set just before the one reload, cleared once the chunk loads or the error shows. */
export const CHUNK_RELOAD_KEY = "mojito-chunk-reload";

// What a failed dynamic import says, per engine (Chromium, Firefox, Safari), plus Vite's own
// preload failure for a chunk's CSS or its dependencies.
const CHUNK_ERRORS = [
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Unable to preload CSS/i,
  /Failed to load module script/i,
];

export function isChunkLoadError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === "ChunkLoadError" || CHUNK_ERRORS.some((re) => re.test(err.message));
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * What to do with a route error: `"reload"` (and the guard is set) for the first chunk-load
 * failure, `"show"` for anything else — including the second chunk failure in a row, whose
 * guard is cleared so a later deploy can reload again. Without usable storage there is no way
 * to tell a first failure from a loop, so it shows.
 */
export function chunkErrorAction(err: unknown, storage: Store | null): "reload" | "show" {
  if (!isChunkLoadError(err) || !storage) return "show";
  try {
    if (storage.getItem(CHUNK_RELOAD_KEY)) {
      storage.removeItem(CHUNK_RELOAD_KEY);
      return "show";
    }
    storage.setItem(CHUNK_RELOAD_KEY, "1");
    return "reload";
  } catch {
    return "show";
  }
}

/** The chunk loaded: a later failure is a new one and earns its own reload. */
export function chunkLoaded(storage: Store | null): void {
  try {
    storage?.removeItem(CHUNK_RELOAD_KEY);
  } catch {
    // storage unavailable: nothing was stored either
  }
}

/** `window.sessionStorage`, or null where touching it throws (Safari private mode, sandboxed frames). */
export function sessionStore(): Store | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
