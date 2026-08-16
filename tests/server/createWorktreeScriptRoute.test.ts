import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/server/projectStack", () => ({ resolveStack: vi.fn() }));
vi.mock("@/server/launch", () => ({ launchCustomSession: vi.fn() }));

import { POST } from "@/app/api/stacks/[slug]/create-worktree-script/route";
import { resolveStack } from "@/server/projectStack";
import { launchCustomSession } from "@/server/launch";

const TOKEN = "test-token";
function preq(slug: string, auth = true): [Request, { params: Promise<{ slug: string }> }] {
  return [
    new Request(`http://localhost/api/stacks/${slug}/create-worktree-script`, {
      method: "POST", headers: auth ? { "x-mojito-token": TOKEN } : {},
    }),
    { params: Promise.resolve({ slug }) },
  ];
}

beforeEach(() => {
  process.env.MOJITO_TOKEN = TOKEN;
  process.env.LINEAR_API_KEY = "k";
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/stacks/[slug]/create-worktree-script", () => {
  it("401 without token", async () => {
    expect((await POST(...preq("factorybook", false))).status).toBe(401);
  });

  it("404 for an unmapped slug", async () => {
    vi.mocked(resolveStack).mockReturnValue(null);
    expect((await POST(...preq("nope"))).status).toBe(404);
  });

  it("201 with meta on success, launching a project-scoped session with a guided prompt", async () => {
    vi.mocked(resolveStack).mockReturnValue({ project: "Factorybook", path: "/repo/fb", hasStack: true, pullable: true, self: false });
    vi.mocked(launchCustomSession).mockResolvedValue({ ok: true, meta: { id: "mojito-custom-factorybook-abc", kind: "custom" } as never });
    const res = await POST(...preq("factorybook"));
    expect(res.status).toBe(201);
    expect((await res.json()).meta.id).toBe("mojito-custom-factorybook-abc");
    const call = vi.mocked(launchCustomSession).mock.calls[0][0];
    expect(call.projectName).toBe("Factorybook");
    expect(call.ticket).toBeUndefined();
    expect(call.prompt).toContain("init-worktree.sh");
  });

  // Even the Mojito self-row (not pullable) should be able to get its own setup script written.
  it("works for a non-pullable row (e.g. Mojito's own checkout)", async () => {
    vi.mocked(resolveStack).mockReturnValue({ project: "Mojito", path: "/repo/mojito", hasStack: false, pullable: false, self: true });
    vi.mocked(launchCustomSession).mockResolvedValue({ ok: true, meta: { id: "mojito-custom-mojito-abc", kind: "custom" } as never });
    const res = await POST(...preq("mojito"));
    expect(res.status).toBe(201);
  });

  it("422 when the launch cannot resolve a repo", async () => {
    vi.mocked(resolveStack).mockReturnValue({ project: "Factorybook", path: "/repo/fb", hasStack: true, pullable: true, self: false });
    vi.mocked(launchCustomSession).mockResolvedValue({ ok: false, reason: "no-repo" });
    expect((await POST(...preq("factorybook"))).status).toBe(422);
  });
});
