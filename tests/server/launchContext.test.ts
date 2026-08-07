import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeLaunchContext, type LaunchContext, writeNewTicketContext, type NewTicketContext } from "@/server/launchContext";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "mojito-")); });

const ctx: LaunchContext = {
  identifier: "RIC-46",
  statusName: "To Review",
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

const newCtx: NewTicketContext = { brief: "Aggiungi un pulsante per esportare in CSV", project: "Mojito", images: [] };

describe("writeNewTicketContext", () => {
  it("writes the { brief, project } JSON and returns its path", () => {
    const p = writeNewTicketContext(dir, "mojito-custom-mojito-abc123", newCtx);
    expect(p).toBe(join(dir, "context", "mojito-custom-mojito-abc123.json"));
    expect(JSON.parse(readFileSync(p, "utf8"))).toEqual(newCtx);
  });

  it("writes with owner-only permissions", () => {
    const p = writeNewTicketContext(dir, "mojito-custom-mojito-abc123", newCtx);
    expect(statSync(p).mode & 0o777).toBe(0o600);
  });

  it("accepts a null project", () => {
    const p = writeNewTicketContext(dir, "mojito-custom-general-abc123", { brief: "x", project: null, images: [] });
    expect(JSON.parse(readFileSync(p, "utf8"))).toEqual({ brief: "x", project: null, images: [] });
  });
});
