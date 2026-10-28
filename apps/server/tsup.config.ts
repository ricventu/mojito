import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  target: "node22",
  // Native modules stay in node_modules, loaded at runtime.
  external: ["better-sqlite3", "node-pty"],
  // @mojito/shared is TypeScript source with no build of its own: left external, dist/main.js
  // would import a .ts file node cannot load. tsup's CLI has no flag for this.
  noExternal: ["@mojito/shared"],
});
