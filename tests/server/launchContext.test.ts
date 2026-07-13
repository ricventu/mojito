import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeLaunchContext, type LaunchContext } from "@/server/launchContext";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "mojito-")); });

const ctx: LaunchContext = {
  identifier: "RIC-46",
  statusName: "To Review",
  title: "Toggle auto-advance from the terminal view",
  project: "Mojito",
  labels: ["Bug"],
};

describe("writeLaunchContext", () => {
  it("writes the context JSON and returns its path", () => {
    const p = writeLaunchContext(dir, "mojito-RIC-46-to-review", ctx);
    expect(p).toBe(join(dir, "context", "mojito-RIC-46-to-review.json"));
    expect(JSON.parse(readFileSync(p, "utf8"))).toEqual(ctx);
  });

  it("writes with owner-only permissions", () => {
    const p = writeLaunchContext(dir, "mojito-RIC-46-to-review", ctx);
    expect(statSync(p).mode & 0o777).toBe(0o600);
  });
});
