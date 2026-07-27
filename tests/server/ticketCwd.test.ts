import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveTicketCwd } from "@/server/ticketCwd";

let dir: string;
let projectsPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mojito-tcwd-"));
  projectsPath = join(dir, "lime-projects.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function projects(map: Record<string, string>) {
  writeFileSync(projectsPath, JSON.stringify(map));
}

describe("resolveTicketCwd", () => {
  it("returns the repo root when the project maps and no worktree matches", () => {
    const repo = join(dir, "repo");
    mkdirSync(repo);
    // resolveRepoFromMap indexes by Linear team key ("RIC", parsed from the ticket),
    // not by human project name — matches the fixture shape used across launch.test.ts.
    projects({ RIC: repo });
    expect(resolveTicketCwd(projectsPath, "RIC-162", "Mojito")).toBe(repo);
  });

  it("returns null when the project does not map to a repo", () => {
    projects({});
    expect(resolveTicketCwd(projectsPath, "RIC-162", "Unknown")).toBeNull();
  });

  it("returns null for a malformed ticket id instead of throwing", () => {
    projects({ Mojito: dir });
    expect(resolveTicketCwd(projectsPath, "not-a-ticket", "Mojito")).toBeNull();
  });

  it("returns null when the projects file is missing", () => {
    expect(resolveTicketCwd(join(dir, "absent.json"), "RIC-162", "Mojito")).toBeNull();
  });
});
