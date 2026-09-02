import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/server/projectStack", () => ({ resolveStack: vi.fn() }));
vi.mock("@/server/launch", () => ({ launchCustomSession: vi.fn() }));

import { POST } from "@/app/api/stacks/[slug]/claude-deploy/route";
import { resolveStack } from "@/server/projectStack";
import { launchCustomSession } from "@/server/launch";

const TOKEN = "test-token";
function preq(slug: string, auth = true): [Request, { params: Promise<{ slug: string }> }] {
  return [
    new Request(`http://localhost/api/stacks/${slug}/claude-deploy`, {
      method: "POST", headers: auth ? { "x-mojito-token": TOKEN } : {},
    }),
    { params: Promise.resolve({ slug }) },
  ];
}

const target = { project: "Factorybook", path: "/repo/fb", hasStack: true, pullable: true, self: false };
const meta = { id: "mojito-custom-factorybook-abc", kind: "custom" } as never;

beforeEach(() => {
  process.env.MOJITO_TOKEN = TOKEN;
  process.env.LINEAR_API_KEY = "k";
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/stacks/[slug]/claude-deploy", () => {
  it("401 without token", async () => {
    expect((await POST(...preq("factorybook", false))).status).toBe(401);
  });

  it("404 for an unmapped slug", async () => {
    vi.mocked(resolveStack).mockReturnValue(null);
    expect((await POST(...preq("nope"))).status).toBe(404);
  });

  it("201 with meta, launching a project-scoped opus/high session with the deploy prompt", async () => {
    vi.mocked(resolveStack).mockReturnValue(target);
    vi.mocked(launchCustomSession).mockResolvedValue({ ok: true, meta });
    const res = await POST(...preq("factorybook"));
    expect(res.status).toBe(201);
    expect((await res.json()).meta.id).toBe("mojito-custom-factorybook-abc");
    const call = vi.mocked(launchCustomSession).mock.calls[0][0];
    expect(call).toMatchObject({
      projectName: "Factorybook",
      model: "opus",
      effort: "high",
      prompt: "fai pull e deploy in produzione",
    });
    // Project-scoped, so the session opens in the repo root — there is no ticket, and
    // therefore no worktree, for a deploy.
    expect(call.ticket).toBeUndefined();
  });

  // The action is offered on the self-row too, where it means the project's own
  // production rather than Mojito's guarded self-update of this server.
  it("works for a non-pullable row (Mojito's own checkout)", async () => {
    vi.mocked(resolveStack).mockReturnValue({ project: "Mojito", path: "/repo/mojito", hasStack: false, pullable: false, self: true });
    vi.mocked(launchCustomSession).mockResolvedValue({ ok: true, meta });
    expect((await POST(...preq("mojito"))).status).toBe(201);
  });

  it("422 when the launch cannot resolve a repo", async () => {
    vi.mocked(resolveStack).mockReturnValue(target);
    vi.mocked(launchCustomSession).mockResolvedValue({ ok: false, reason: "no-repo" });
    expect((await POST(...preq("factorybook"))).status).toBe(422);
  });
});
