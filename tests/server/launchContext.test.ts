import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeLaunchContext, type LaunchContext } from "@/server/launchContext";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "mojito-")); });

const ctx: LaunchContext = {
  identifier: "RIC-46",
  statusName: "In Progress",
  title: "Toggle auto-advance from the terminal view",
  project: "Mojito",
  labels: ["Bug"],
  description: "Add a toggle to enable/disable auto-advance from the terminal view.",
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

  it("includes rejectReason when given (QA rework)", () => {
    const p = writeLaunchContext(dir, "mojito-RIC-46-to-code", { ...ctx, rejectReason: "missed the edge case" });
    expect(JSON.parse(readFileSync(p, "utf8"))).toEqual({ ...ctx, rejectReason: "missed the edge case" });
  });
});

describe("writeLaunchContext asset fields", () => {
  it("round-trips assets and attachments", () => {
    const withAssets: LaunchContext = {
      ...ctx,
      assets: [{ url: "https://uploads.linear.app/w/a.png", localPath: "/state/context/s-assets/01-a.png" }],
      attachments: [
        { title: "Spec", url: "https://uploads.linear.app/w/s.pdf", localPath: "/state/context/s-assets/02-s.pdf" },
        { title: "The PR", url: "https://github.com/x/y/pull/1" },
      ],
    };
    const p = writeLaunchContext(dir, "mojito-RIC-46-work", withAssets);
    expect(JSON.parse(readFileSync(p, "utf8"))).toEqual(withAssets);
  });

  it("omits both fields when the ticket carries nothing", () => {
    const p = writeLaunchContext(dir, "mojito-RIC-46-work", ctx);
    const written = JSON.parse(readFileSync(p, "utf8"));
    expect("assets" in written).toBe(false);
    expect("attachments" in written).toBe(false);
  });
});
