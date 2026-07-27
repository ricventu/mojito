import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Only the target resolver is mocked: docFiles (resolveDocPath, readDoc) runs for
// real. This is the regression net for the security boundary — docsRoute.test.ts
// mocks docFiles entirely, so it would not notice a future refactor that stopped
// calling resolveDocPath before reading a file.
vi.mock("@/server/docTarget", () => {
  const deps = { session: () => undefined, projectsPath: "/projects.json" };
  return {
    resolveDocsTarget: vi.fn(),
    docsDeps: vi.fn(() => deps),
  };
});

import { GET as CONTENT } from "@/app/api/docs/content/route";
import { resolveDocsTarget } from "@/server/docTarget";

const TOKEN = "test-token";
const SECRET = "SECRET-CONTENT-DO-NOT-LEAK";

let base: string;
let worktree: string;

beforeEach(() => {
  process.env.MOJITO_TOKEN = TOKEN;
  process.env.LINEAR_API_KEY = "k";
  base = mkdtempSync(join(tmpdir(), "mojito-docs-int-"));
  worktree = join(base, "repo");
  mkdirSync(join(worktree, "docs/superpowers/specs"), { recursive: true });
  writeFileSync(join(worktree, "docs/superpowers/specs/a-design.md"), "# real spec\n");
  // One level above the worktree root — outside the security boundary.
  writeFileSync(join(base, "secret.md"), SECRET);
  vi.mocked(resolveDocsTarget).mockReset();
  vi.mocked(resolveDocsTarget).mockReturnValue({ ok: true, root: worktree, label: "RIC-1" });
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function req(qs: string): Request {
  return new Request(`http://localhost/api/docs/content?${qs}`, {
    headers: { "x-mojito-token": TOKEN },
  });
}

describe("GET /api/docs/content (real docFiles, only docTarget mocked)", () => {
  it("200s a legitimate path with the real file content", async () => {
    const res = await CONTENT(req("ticket=RIC-1&path=docs/superpowers/specs/a-design.md"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      path: "docs/superpowers/specs/a-design.md",
      content: "# real spec\n",
    });
  });

  // `base` only exists once beforeEach has run, so each entry builds its query
  // string lazily rather than at describe-collection time.
  const attacks: [string, () => string][] = [
    ["a parent traversal", () => "path=../secret.md"],
    ["dot-dot through a real subdir", () => "path=docs/../../secret.md"],
    ["a percent-encoded traversal, as it arrives in the query string", () => "path=%2e%2e%2fsecret.md"],
    ["an absolute path straight at the secret", () => `path=${encodeURIComponent(join(base, "secret.md"))}`],
    ["a path with an embedded NUL byte", () => `path=${encodeURIComponent("docs/a\0.md")}`],
  ];

  for (const [label, qs] of attacks) {
    it(`rejects ${label} without leaking the secret`, async () => {
      const res = await CONTENT(req(`ticket=RIC-1&${qs()}`));
      expect([400, 404]).toContain(res.status);
      expect(await res.text()).not.toContain(SECRET);
    });
  }
});
