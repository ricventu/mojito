import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// `pnpm dev` runs on the box beside the service: it must neither take the service's port nor
// open its database (a tsx restart fails the service's running tasks, a branch's migration
// would reach production).
describe("the server's dev script", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const dev: string = pkg.scripts.dev;

  it("pins the port Vite proxies to", () => {
    expect(dev).toMatch(/\bMOJITO_PORT=3100\b/);
  });

  it("uses a state dir of its own", () => {
    expect(dev).toMatch(/\bMOJITO_STATE_DIR=\S*\.local\/state\/mojito-dev\b/);
  });
});
