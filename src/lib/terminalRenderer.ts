/**
 * Puts the browser terminal on the WebGL renderer, and takes it off again when
 * the GPU context goes away.
 *
 * The DOM renderer's worst case is exactly Mojito's: tmux repainting claude's
 * full-screen TUI, where every changed cell is DOM work. WebGL2 moves that onto
 * the GPU.
 *
 * **The fallback is the whole point of this module.** Safari discards a WebGL
 * context when the tab goes to the background — the normal state of a phone in a
 * pocket, and the same reason `startHeartbeat` exists. Loading the addon and
 * walking away leaves the terminal **black** instead of degrading to the DOM
 * renderer, so the loss path is what is tested here.
 *
 * Two things about the addon are worth knowing, both read off its source rather
 * than assumed:
 *
 * - `dispose()` *is* the fallback. `WebglAddon.activate` registers a disposable
 *   that calls `renderService.setRenderer(core._createRenderer())` and re-runs
 *   `handleResize`, so disposing hands the terminal back to the DOM renderer
 *   with its buffer intact. There is nothing else to restore.
 * - `onContextLoss` is not `webglcontextlost`. The renderer swallows that event,
 *   `preventDefault()`s it to allow restoration, and waits **3 seconds** for
 *   `webglcontextrestored`. A context the browser gives back — the common case
 *   when a tab returns to the foreground — never reaches us at all. `onContextLoss`
 *   means "gone for good", which is why the fall back to DOM is permanent: a
 *   context that was refused once will be refused again, and re-loading would
 *   only flip the terminal between renderers.
 *
 * Loading is allowed to fail. `WebglAddon`'s constructor throws on Safari < 16
 * without WebGL2, and `activate` throws "WebGL2 not supported" when the context
 * cannot be created at all. Neither may escape: this runs partway through the
 * terminal's mount, so an unhandled throw would take the socket, the resize
 * handlers and the touch scroll with it and leave a dead terminal where a
 * DOM-rendered one would have worked fine.
 *
 * The pure half of the usual split (cf. `resolveInitialToken` ÷ `useToken`) —
 * the addon is injected, so the whole lifecycle is testable in the node-only
 * vitest setup, where no canvas and no WebGL2 context exist.
 */

export interface WebglAddonLike {
  onContextLoss(listener: () => void): { dispose(): void };
  dispose(): void;
}

/**
 * Just the half of `Terminal` this needs. Generic over the addon because
 * `Terminal.loadAddon` is declared against `ITerminalAddon`, which is neither a
 * super- nor a subtype of `WebglAddonLike` — pinning the parameter to the
 * concrete addon lets a real `Terminal` and a test fake both satisfy it without
 * a cast. `NoInfer` so the addon type is read off the factory alone: inferring
 * it from here too makes `ITerminalAddon` a candidate, and the union of the two
 * satisfies neither side.
 */
export interface WebglHost<A extends WebglAddonLike = WebglAddonLike> {
  loadAddon(addon: NoInfer<A>): void;
}

/** Dispose without letting a second failure escape a path that is already cleaning up. */
function quietly(fn: () => void): void {
  try {
    fn();
  } catch {
    /* the addon is going away either way */
  }
}

/**
 * Loads the WebGL addon and returns the teardown for it. The teardown is
 * idempotent and safe to call after a context loss has already dropped the
 * renderer, because the mount's teardown runs unconditionally.
 */
export function attachWebglRenderer<A extends WebglAddonLike>(
  term: WebglHost<A>,
  createAddon: () => A,
): () => void {
  let addon: A;
  try {
    addon = createAddon();
  } catch {
    return () => {};
  }

  let released = false;
  let loss: { dispose(): void } | null = null;
  const release = () => {
    if (released) return;
    released = true;
    quietly(() => loss?.dispose());
    quietly(() => addon.dispose());
  };

  try {
    term.loadAddon(addon);
  } catch {
    // `activate` threw partway through: the terminal never finished adopting the
    // addon, so cleaning it up is ours to do.
    release();
    return () => {};
  }

  loss = addon.onContextLoss(release);
  return release;
}
