import { describe, it, expect } from "vitest";
import { attachWebglRenderer, type WebglAddonLike, type WebglHost } from "@/lib/terminalRenderer";

/**
 * A stand-in for WebglAddon that records what was done to it. The real addon
 * needs a canvas and a WebGL2 context, neither of which exists in the node-only
 * test environment — but every behaviour under test here is about the *order*
 * of load / context-loss / dispose, which the fake reproduces exactly.
 */
function fakeAddon() {
  const addon = {
    disposeCount: 0,
    listeners: [] as (() => void)[],
    listenerDisposeCount: 0,
    onContextLoss(listener: () => void) {
      addon.listeners.push(listener);
      return { dispose: () => { addon.listenerDisposeCount += 1; } };
    },
    dispose() { addon.disposeCount += 1; },
    /** What the browser does when it takes the GPU context away for good. */
    loseContext() { for (const l of [...addon.listeners]) l(); },
  };
  return addon;
}

function fakeTerm() {
  const term = {
    loaded: [] as WebglAddonLike[],
    loadAddon(addon: WebglAddonLike) { term.loaded.push(addon); },
  };
  return term;
}

describe("attachWebglRenderer", () => {
  it("loads the addon onto the terminal", () => {
    const term = fakeTerm();
    const addon = fakeAddon();

    attachWebglRenderer(term, () => addon);

    expect(term.loaded).toEqual([addon]);
  });

  // Disposing WebglAddon is what puts the DOM renderer back: its `activate`
  // registers a disposable that calls `renderService.setRenderer(_createRenderer())`.
  // Without this the terminal just stays black.
  it("disposes the addon when the context is lost, falling back to the DOM renderer", () => {
    const term = fakeTerm();
    const addon = fakeAddon();
    attachWebglRenderer(term, () => addon);

    addon.loseContext();

    expect(addon.disposeCount).toBe(1);
  });

  it("never reloads the addon after a context loss", () => {
    const term = fakeTerm();
    const addon = fakeAddon();
    let built = 0;
    attachWebglRenderer(term, () => { built += 1; return addon; });

    addon.loseContext();

    expect(built).toBe(1);
    expect(term.loaded).toHaveLength(1);
  });

  it("disposes only once when the loss event arrives twice", () => {
    const term = fakeTerm();
    const addon = fakeAddon();
    attachWebglRenderer(term, () => addon);

    addon.loseContext();
    addon.loseContext();

    expect(addon.disposeCount).toBe(1);
  });

  it("disposes the addon on teardown", () => {
    const term = fakeTerm();
    const addon = fakeAddon();
    const detach = attachWebglRenderer(term, () => addon);

    detach();

    expect(addon.disposeCount).toBe(1);
  });

  // The unmount teardown runs unconditionally, so it lands on a terminal whose
  // addon a context loss already disposed. Disposing twice must not happen.
  it("does not dispose again on teardown after a context loss", () => {
    const term = fakeTerm();
    const addon = fakeAddon();
    const detach = attachWebglRenderer(term, () => addon);

    addon.loseContext();
    detach();

    expect(addon.disposeCount).toBe(1);
  });

  it("is idempotent when teardown runs twice", () => {
    const term = fakeTerm();
    const addon = fakeAddon();
    const detach = attachWebglRenderer(term, () => addon);

    detach();
    detach();

    expect(addon.disposeCount).toBe(1);
  });

  it("releases the context-loss listener on teardown", () => {
    const term = fakeTerm();
    const addon = fakeAddon();
    const detach = attachWebglRenderer(term, () => addon);

    detach();

    expect(addon.listenerDisposeCount).toBe(1);
  });

  // WebglAddon's constructor throws outright on Safari < 16 without WebGL2 in
  // developer settings. The terminal must open on the DOM renderer regardless —
  // an unhandled throw here would abort the rest of the mount (the socket, the
  // resize handlers, the touch scroll) and leave a dead terminal.
  it("stays on the DOM renderer when the addon constructor throws", () => {
    const term = fakeTerm();

    const detach = attachWebglRenderer(term, () => {
      throw new Error("Webgl2 is only supported on Safari 16 and above");
    });

    expect(term.loaded).toEqual([]);
    expect(() => detach()).not.toThrow();
  });

  // The other failure mode: the constructor succeeds and `activate` throws
  // ("WebGL2 not supported") from inside loadAddon. The half-built addon is ours
  // to clean up, since the terminal never finished adopting it.
  it("disposes the addon when loading it throws, and stays on the DOM renderer", () => {
    const addon = fakeAddon();
    const term: WebglHost = {
      loadAddon() { throw new Error("WebGL2 not supported null"); },
    };

    const detach = attachWebglRenderer(term, () => addon);

    expect(addon.disposeCount).toBe(1);
    detach();
    expect(addon.disposeCount).toBe(1);
  });

  it("survives an addon that throws while being disposed", () => {
    const term = fakeTerm();
    const addon = {
      ...fakeAddon(),
      dispose() { throw new Error("already gone"); },
    };

    const detach = attachWebglRenderer(term, () => addon);

    expect(() => detach()).not.toThrow();
  });
});
