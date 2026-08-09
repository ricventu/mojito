import { describe, it, expect, beforeEach, vi } from "vitest";

// vi.mock is hoisted above the imports, so every spy has to be hoisted with it.
const h = vi.hoisted(() => ({
  getIssueContent: vi.fn(async () => ({
    description: "![](https://uploads.linear.app/w/a/one.png)",
    attachments: [{ title: "The PR", url: "https://github.com/x/y/pull/1" }],
  })),
  downloadLinearAsset: vi.fn(async () => ({ bytes: Buffer.from([1]), contentType: "image/png" })),
  // Mocked, not exercised: prepareTicketAssets has its own test file, and mocking it keeps
  // this one about wiring rather than about the filesystem.
  // The param type mirrors the real PrepareTicketAssetsInput so mock.calls[0][0] can be
  // cast to either the id/stateDir shape or the download-callback shape below.
  prepareTicketAssets: vi.fn(async (input: {
    id: string; stateDir: string; description: string;
    attachments: { title: string; url: string }[];
    download: (url: string) => Promise<{ bytes: Buffer; contentType: string }>;
  }) => ({
    assets: input.description
      ? [{ url: "https://uploads.linear.app/w/a/one.png", localPath: "/state/context/x-assets/01-one.png" }]
      : [],
    attachments: input.attachments,
  })),
  setIssueStatus: vi.fn(async () => {}),
  // Takes an (unused) param so mock.calls[0][0] indexes into a non-empty tuple below.
  launchSession: vi.fn(async (_req: unknown) => ({ ok: true, meta: { id: "mojito-RIC-46-work" } }) as
    { ok: boolean; reason?: string; meta?: unknown }),
  launchCustomSession: vi.fn(async () => ({ ok: true, meta: {} })),
  launchShellSession: vi.fn(async () => ({ ok: true, meta: {} })),
}));

vi.mock("@/server/linear", () => ({
  getIssueContent: h.getIssueContent, downloadLinearAsset: h.downloadLinearAsset,
  setIssueStatus: h.setIssueStatus,
}));
vi.mock("@/server/ticketAssets", () => ({
  prepareTicketAssets: h.prepareTicketAssets, MAX_ASSET_BYTES: 10 * 1024 * 1024,
}));
vi.mock("@/server/launch", () => ({
  launchSession: h.launchSession, launchCustomSession: h.launchCustomSession,
  launchShellSession: h.launchShellSession,
}));
vi.mock("@/server/tmux", () => ({
  hasSession: vi.fn(async () => false), newSession: vi.fn(async () => {}), pipePane: vi.fn(async () => {}),
}));
vi.mock("@/server/app", () => ({
  getConfig: () => ({ token: "test-token", linearApiKey: "k", stateDir: "/state", port: 4711,
    projectsPath: "/projects.json" }),
  getRegistry: () => ({ all: () => [] }),
}));

import { POST } from "@/app/api/sessions/route";

const TOKEN = "test-token";
function req(body: unknown): Request {
  return new Request("http://localhost/api/sessions", {
    method: "POST",
    headers: { "x-mojito-token": TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const launch = { ticket: "RIC-46", status: "In Progress", projectName: "Mojito", title: "Some ticket" };

beforeEach(() => {
  vi.clearAllMocks();
  h.getIssueContent.mockImplementation(async () => ({
    description: "![](https://uploads.linear.app/w/a/one.png)",
    attachments: [{ title: "The PR", url: "https://github.com/x/y/pull/1" }],
  }));
  h.downloadLinearAsset.mockImplementation(async () => ({ bytes: Buffer.from([1]), contentType: "image/png" }));
  h.prepareTicketAssets.mockImplementation(async (input) => ({
    assets: input.description
      ? [{ url: "https://uploads.linear.app/w/a/one.png", localPath: "/state/context/x-assets/01-one.png" }]
      : [],
    attachments: input.attachments,
  }));
  h.launchSession.mockImplementation(async () => ({ ok: true, meta: { id: "mojito-RIC-46-work" } }));
});

describe("POST /api/sessions (ticket)", () => {
  it("prepares the assets under the session's own id and hands them to launchSession", async () => {
    const res = await POST(req(launch));
    expect(res.status).toBe(201);
    const prep = h.prepareTicketAssets.mock.calls[0][0] as {
      id: string; stateDir: string; description: string; attachments: { title: string }[];
    };
    expect(prep.id).toBe("mojito-RIC-46-work"); // tmuxName collapses the work states
    expect(prep.stateDir).toBe("/state");
    expect(prep.description).toBe("![](https://uploads.linear.app/w/a/one.png)");
    const passed = h.launchSession.mock.calls[0][0] as {
      assets: { url: string }[]; attachments: { title: string; localPath?: string }[];
    };
    expect(passed.assets.map((a) => a.url)).toEqual(["https://uploads.linear.app/w/a/one.png"]);
    expect(passed.attachments).toEqual([{ title: "The PR", url: "https://github.com/x/y/pull/1" }]);
  });

  it("gives prepareTicketAssets a download bound to the Linear API key and the size cap", async () => {
    await POST(req(launch));
    const prep = h.prepareTicketAssets.mock.calls[0][0] as {
      download: (url: string) => Promise<unknown>;
    };
    await prep.download("https://uploads.linear.app/w/a/one.png");
    expect(h.downloadLinearAsset)
      .toHaveBeenCalledWith("k", "https://uploads.linear.app/w/a/one.png", 10 * 1024 * 1024);
  });

  it("launches with an empty description and no assets when Linear is down", async () => {
    h.getIssueContent.mockImplementation(async () => { throw new Error("Linear down"); });
    const res = await POST(req(launch));
    expect(res.status).toBe(201);
    const passed = h.launchSession.mock.calls[0][0] as { description: string; assets: unknown[] };
    expect(passed.description).toBe("");
    expect(passed.assets).toEqual([]);
  });

  it("rejects a malformed ticket id with 422 rather than a 500", async () => {
    const res = await POST(req({ ...launch, ticket: "not a ticket" }));
    expect(res.status).toBe(422);
    expect(h.launchSession).not.toHaveBeenCalled();
  });
});
