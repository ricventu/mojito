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
  // Same (unused) param as launchSession above, so mock.calls[0][0] is indexable.
  launchCustomSession: vi.fn(async (_req: unknown) => ({ ok: true, meta: {} })),
  launchShellSession: vi.fn(async (_req: unknown) => ({ ok: true, meta: {} })),
  // Controllable per test so one test can prove the duplicate check runs before assets
  // are ever touched.
  hasSession: vi.fn(async () => false),
}));

vi.mock("@/server/linear", () => ({
  getIssueContent: h.getIssueContent, downloadLinearAsset: h.downloadLinearAsset,
  setIssueStatus: h.setIssueStatus,
}));
vi.mock("@/server/ticketAssets", async () => {
  // Pins the mock to the real constant rather than a hand-copied number, so this test
  // would fail if MAX_ASSET_BYTES ever changed without the assertion being updated too.
  const actual = await vi.importActual<typeof import("@/server/ticketAssets")>("@/server/ticketAssets");
  return { prepareTicketAssets: h.prepareTicketAssets, MAX_ASSET_BYTES: actual.MAX_ASSET_BYTES };
});
vi.mock("@/server/launch", () => ({
  launchSession: h.launchSession, launchCustomSession: h.launchCustomSession,
  launchShellSession: h.launchShellSession,
}));
vi.mock("@/server/tmux", () => ({
  hasSession: h.hasSession, newSession: vi.fn(async () => {}), pipePane: vi.fn(async () => {}),
}));
vi.mock("@/server/app", () => ({
  getConfig: () => ({ token: "test-token", linearApiKey: "k", stateDir: "/state", port: 4711,
    projectsPath: "/projects.json" }),
  getRegistry: () => ({ all: () => [] }),
  // The launchers arm the startup-stall watch off this bus (startupStall.ts).
  getBus: () => ({ emit: () => {}, subscribe: () => () => {} }),
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
  h.hasSession.mockImplementation(async () => false);
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

  // A live session under that id already owns its <id>-assets directory: preparing
  // assets before this check would clear and redownload into it, corrupting a running
  // session's files for a request that is going to 409 anyway.
  it("409s on a duplicate live session without ever preparing or downloading assets", async () => {
    h.hasSession.mockImplementation(async () => true);
    const res = await POST(req(launch));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "duplicate", id: "mojito-RIC-46-work" });
    expect(h.prepareTicketAssets).not.toHaveBeenCalled();
    expect(h.launchSession).not.toHaveBeenCalled();
  });

  it("forwards createWorktree/baseBranch to launchSession", async () => {
    await POST(req({ ...launch, createWorktree: true, baseBranch: "main" }));
    const passed = h.launchSession.mock.calls[0][0] as { createWorktree: boolean; baseBranch: string };
    expect(passed.createWorktree).toBe(true);
    expect(passed.baseBranch).toBe("main");
  });

  it("defaults createWorktree to false when the request omits it", async () => {
    await POST(req(launch));
    const passed = h.launchSession.mock.calls[0][0] as { createWorktree: boolean };
    expect(passed.createWorktree).toBe(false);
  });

  it("forwards a picked worktree to launchSession", async () => {
    await POST(req({ ...launch, worktree: "/repo/.claude/worktrees/RIC-9-x" }));
    const passed = h.launchSession.mock.calls[0][0] as { worktree?: string };
    expect(passed.worktree).toBe("/repo/.claude/worktrees/RIC-9-x");
  });

  // A non-string worktree must not travel: it ends up in resolveWorktreePick, whose
  // string comparison would silently treat anything else as "no match" — but the route is
  // where a malformed body stops.
  it("drops a non-string worktree", async () => {
    await POST(req({ ...launch, worktree: { evil: true } }));
    const passed = h.launchSession.mock.calls[0][0] as { worktree?: string };
    expect(passed.worktree).toBeUndefined();
  });
});

describe("POST /api/sessions — the picked worktree on custom and shell launches", () => {
  it("forwards it for a project-scoped custom session", async () => {
    await POST(req({ kind: "custom", projectName: "Mojito", worktree: "/repo/wt" }));
    const passed = h.launchCustomSession.mock.calls[0][0] as { worktree?: string };
    expect(passed.worktree).toBe("/repo/wt");
  });

  it("forwards it for a ticket-scoped custom session", async () => {
    await POST(req({ kind: "custom", projectName: "Mojito", ticket: "RIC-46", status: "In Progress", worktree: "/repo/wt" }));
    const passed = h.launchCustomSession.mock.calls[0][0] as { worktree?: string; ticket?: string };
    expect(passed.ticket).toBe("RIC-46");
    expect(passed.worktree).toBe("/repo/wt");
  });

  it("forwards it for a project-scoped shell", async () => {
    await POST(req({ kind: "shell", projectName: "Mojito", worktree: "/repo/wt" }));
    const passed = h.launchShellSession.mock.calls[0][0] as { worktree?: string };
    expect(passed.worktree).toBe("/repo/wt");
  });

  it("forwards it for a ticket-scoped shell", async () => {
    await POST(req({ kind: "shell", projectName: "Mojito", ticket: "RIC-46", status: "In Progress", worktree: "/repo/wt" }));
    const passed = h.launchShellSession.mock.calls[0][0] as { worktree?: string; ticket?: string };
    expect(passed.ticket).toBe("RIC-46");
    expect(passed.worktree).toBe("/repo/wt");
  });

  it("drops a non-string worktree on a custom launch too", async () => {
    await POST(req({ kind: "custom", projectName: "Mojito", worktree: 42 }));
    const passed = h.launchCustomSession.mock.calls[0][0] as { worktree?: string };
    expect(passed.worktree).toBeUndefined();
  });

  // The board move is best-effort by design (the session is already running, so a failed
  // status write must not fail the request) — but silence made a stuck board look normal.
  it("still returns 201 and warns when the Backlog -> In Progress board move fails", async () => {
    h.setIssueStatus.mockImplementation(async () => { throw new Error("Linear 500"); });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const res = await POST(req({ ...launch, status: "Backlog" }));
      expect(res.status).toBe(201);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("RIC-46"));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("Linear 500"));
    } finally {
      warn.mockRestore();
    }
  });
});
