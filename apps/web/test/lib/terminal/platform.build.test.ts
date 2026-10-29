import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { build, type Rolldown } from "vite";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Safari/605.1.15";

// The regression guard platform.ts promises. xterm settles isMac at module load behind a
// `typeof process !== "undefined" && "title" in process` guard; the old app's bundler shimmed
// `process` and every flag came out false — the Mac's Option key turned into Meta. Here xterm
// is bundled through the app's own Vite config (its plugins, aliases and defines: whatever
// would shim `process` in the real build) and run in a context shaped like a browser on a Mac,
// with no `process` but what the bundle itself brings. In vitest, by contrast, xterm *is* in
// node, which is why platform.test.ts can only check that the probe reaches the flag.
describe("xterm platform detection in the Vite build", () => {
  it("sees a Mac as a Mac, not as node", { timeout: 60_000 }, async () => {
    const out = (await build({
      root,
      configFile: `${root}/vite.config.ts`,
      logLevel: "silent",
      build: {
        write: false,
        minify: true,
        lib: { entry: `${root}/test/fixtures/xtermPlatformProbe.ts`, formats: ["iife"], name: "probe" },
        rolldownOptions: { output: { codeSplitting: false } },
      },
    })) as Rolldown.RolldownOutput[];
    const chunk = out.flatMap((o) => o.output).find((f) => f.type === "chunk");
    expect(chunk).toBeDefined();

    // Enough DOM for xterm to load and construct an unopened Terminal: whatever it touches answers
    // another stub. Only the navigator is real, and `process` is deliberately absent.
    const dom: unknown = new Proxy(function () {}, {
      get: (_t, key) => (key === Symbol.toPrimitive ? () => "" : dom),
      apply: () => dom,
      construct: () => dom as object,
    });
    const navigator = { platform: "MacIntel", userAgent: MAC_UA, language: "it-IT" };
    const context: Record<string, unknown> = { navigator, document: dom, console, setTimeout, clearTimeout, queueMicrotask };
    context.window = context;
    context.self = context;
    context.globalThis = context;
    runInNewContext(chunk!.type === "chunk" ? chunk!.code : "", context);

    const probe = context.probe as { xtermPlatform(): { isNode?: unknown; isMac?: unknown } };
    expect(probe.xtermPlatform()).toEqual({ isNode: false, isMac: true });
  });
});
