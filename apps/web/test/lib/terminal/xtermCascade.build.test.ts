import { fileURLToPath } from "node:url";
import { build, type Rolldown } from "vite";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../..", import.meta.url));

/** The `@layer` blocks enclosing `at`, outermost first (a flat brace walk; CSS strings never hold braces here). */
function enclosingLayers(css: string, at: number): string[] {
  const stack: string[] = [];
  let start = 0;
  for (let i = 0; i < at; i++) {
    if (css[i] === "{") {
      stack.push(css.slice(start, i).trim());
      start = i + 1;
    } else if (css[i] === "}") {
      stack.pop();
      start = i + 1;
    } else if (css[i] === ";") {
      start = i + 1;
    }
  }
  return stack.filter((prelude) => prelude.startsWith("@layer"));
}

// TerminalView anchors the xterm element to the bottom of its box (`[&_.xterm]:absolute
// bottom-0`), so with the mobile keyboard up — the terminal keeps its rows, the box loses
// them — the rows cut off are the top ones and claude's input line stays on screen. Those
// are Tailwind utilities, which live in `@layer utilities`; xterm.css sets `.xterm
// { position: relative }`, and an *unlayered* rule beats every layered one whatever its
// specificity. Imported unlayered, xterm.css silently pinned the terminal to the top of its
// box and the keyboard hid the prompt. Only the built CSS shows the cascade, hence a build.
describe("xterm.css in the Vite build", () => {
  it("sits in a cascade layer, below Tailwind's utilities", { timeout: 60_000 }, async () => {
    const out = (await build({
      root,
      configFile: `${root}/vite.config.ts`,
      logLevel: "silent",
      build: { write: false, minify: true },
    })) as Rolldown.RolldownOutput | Rolldown.RolldownOutput[];
    const css = (Array.isArray(out) ? out : [out])
      .flatMap((o) => o.output)
      .filter((f): f is Rolldown.OutputAsset => f.type === "asset" && f.fileName.endsWith(".css"))
      .map((f) => String(f.source));

    const hits = css.flatMap((source) =>
      [...source.matchAll(/(?<![\w-])\.xterm\{[^}]*position:relative/g)].map((m) => enclosingLayers(source, m.index)),
    );
    expect(hits.length).toBeGreaterThan(0);
    for (const layers of hits) {
      expect(layers.length).toBeGreaterThan(0);
      expect(layers.some((l) => /\butilities\b/.test(l))).toBe(false);
    }
  });
});
