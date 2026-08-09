import { describe, it, expect, vi } from "vitest";
import { listOpenIssues, getIssueStatus, getIssueRef, setIssueStatus, setIssueAssignee, uploadImage, getIssueContent, createIssue, downloadLinearAsset } from "@/server/linear";

function fakeFetch(payload: unknown) {
  return vi.fn(async () => ({ ok: true, json: async () => ({ data: payload }) })) as unknown as typeof fetch;
}

function seqFetch(payloads: unknown[]) {
  let i = 0;
  return vi.fn(async () => ({ ok: true, json: async () => ({ data: payloads[i++] }) })) as unknown as typeof fetch;
}

describe("linear client", () => {
  it("maps open issues", async () => {
    const f = fakeFetch({
      issues: {
        nodes: [
          {
            identifier: "RIC-46",
            title: "Do thing",
            state: { name: "In Progress", type: "started" },
            project: { name: "Lime" },
            labels: { nodes: [{ name: "bug" }] },
            assignee: { isMe: true },
          },
        ],
      },
    });
    const items = await listOpenIssues("k", f);
    expect(items[0]).toEqual({
      identifier: "RIC-46",
      title: "Do thing",
      statusName: "In Progress",
      statusType: "started",
      project: "Lime",
      labels: ["bug"],
      assignedToMe: true,
    });
  });

  it("marks unassigned issues and issues assigned to others as not mine", async () => {
    const f = fakeFetch({
      issues: {
        nodes: [
          { identifier: "RIC-1", state: { name: "Backlog" }, assignee: null },
          { identifier: "RIC-2", state: { name: "Backlog" }, assignee: { isMe: false } },
        ],
      },
    });
    const items = await listOpenIssues("k", f);
    expect(items.map((t) => t.assignedToMe)).toEqual([false, false]);
  });

  it("no longer restricts the query to the viewer's own issues", async () => {
    const f = fakeFetch({ issues: { nodes: [] } });
    await listOpenIssues("k", f);
    const body = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string;
    // The assignee survives only as a selected field, never as a filter clause.
    expect(body).not.toContain("isMe: {");
    expect(body).toContain("assignee { isMe }");
    expect(body).toContain("nin");
  });

  it("returns a single issue status", async () => {
    const f = fakeFetch({ issues: { nodes: [{ state: { name: "Planned" } }] } });
    expect(await getIssueStatus("k", "RIC-46", f)).toBe("Planned");
  });
});

describe("linear mutations", () => {
  it("resolves an issue ref (node id + team id + status)", async () => {
    const f = fakeFetch({ issues: { nodes: [{ id: "issue-uuid", state: { name: "To QA" }, team: { id: "team-uuid" } }] } });
    expect(await getIssueRef("k", "RIC-110", f)).toEqual({ id: "issue-uuid", teamId: "team-uuid", statusName: "To QA" });
  });

  it("sets issue status by resolving the target state name to an id", async () => {
    const f = seqFetch([
      { issues: { nodes: [{ id: "issue-uuid", state: { name: "To QA" }, team: { id: "team-uuid" } }] } },
      { team: { states: { nodes: [{ id: "s1", name: "Backlog" }, { id: "s2", name: "Done" }] } } },
      { issueUpdate: { success: true } },
    ]);
    await setIssueStatus("k", "RIC-110", "Done", f);
    const updateCall = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[2][1] as { body: string };
    expect(updateCall.body).toContain("issueUpdate");
    expect(updateCall.body).toContain("s2");
    expect(updateCall.body).toContain("issue-uuid");
  });

  it("throws when the target state does not exist in the team", async () => {
    const f = seqFetch([
      { issues: { nodes: [{ id: "issue-uuid", state: { name: "To QA" }, team: { id: "team-uuid" } }] } },
      { team: { states: { nodes: [{ id: "s1", name: "Backlog" }] } } },
    ]);
    await expect(setIssueStatus("k", "RIC-110", "Done", f)).rejects.toThrow(/Done/);
  });

  it("assigns an issue to the viewer", async () => {
    const f = seqFetch([
      { issues: { nodes: [{ id: "issue-uuid", state: { name: "Backlog" }, team: { id: "team-uuid" } }] } },
      { viewer: { id: "viewer-uuid" } },
      { issueUpdate: { success: true } },
    ]);
    await setIssueAssignee("k", "RIC-169", true, f);
    const calls = (f as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[1][1].body).toContain("viewer");
    const update = JSON.parse(calls[2][1].body as string);
    expect(update.query).toContain("issueUpdate");
    expect(update.variables).toEqual({ id: "issue-uuid", assigneeId: "viewer-uuid" });
  });

  it("unassigns an issue without looking up the viewer", async () => {
    const f = seqFetch([
      { issues: { nodes: [{ id: "issue-uuid", state: { name: "Backlog" }, team: { id: "team-uuid" } }] } },
      { issueUpdate: { success: true } },
    ]);
    await setIssueAssignee("k", "RIC-169", false, f);
    const calls = (f as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    const update = JSON.parse(calls[1][1].body as string);
    expect(update.variables).toEqual({ id: "issue-uuid", assigneeId: null });
  });
});

describe("uploadImage", () => {
  it("uploads bytes to the presigned URL and returns the asset URL", async () => {
    const f = seqFetch([
      { fileUpload: { success: true, uploadFile: {
        uploadUrl: "https://up.example/put",
        assetUrl: "https://uploads.linear.app/abc.png",
        headers: [{ key: "x-amz-acl", value: "public-read" }],
      } } },
      {}, // the PUT response body (unused)
    ]);
    const url = await uploadImage(
      "k",
      { filename: "a.png", contentType: "image/png", size: 3, bytes: new Uint8Array([1, 2, 3]) },
      f,
    );
    expect(url).toBe("https://uploads.linear.app/abc.png");
    const putCall = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(putCall[0]).toBe("https://up.example/put");
    expect(putCall[1].method).toBe("PUT");
    expect(putCall[1].headers["x-amz-acl"]).toBe("public-read");
    expect(putCall[1].headers["Content-Type"]).toBe("image/png");
  });

  it("throws when fileUpload is unsuccessful", async () => {
    const f = fakeFetch({ fileUpload: { success: false } });
    await expect(
      uploadImage("k", { filename: "a.png", contentType: "image/png", size: 1, bytes: new Uint8Array([1]) }, f),
    ).rejects.toThrow(/fileUpload/);
  });
});

function fakeFetchWithCalls(responses: object[]) {
  const calls: { body: string }[] = [];
  let i = 0;
  const impl = (async (_url: unknown, init?: { body?: unknown }) => {
    calls.push({ body: String(init?.body ?? "") });
    const data = responses[Math.min(i++, responses.length - 1)];
    return { ok: true, json: async () => ({ data }) };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("getIssueContent", () => {
  it("returns the description and the attachment list", async () => {
    const impl = fakeFetch({ issues: { nodes: [{
      description: "the body",
      attachments: { nodes: [{ title: "Design", url: "https://figma.com/x" }] },
    }] } });
    expect(await getIssueContent("key", "RIC-46", impl)).toEqual({
      description: "the body",
      attachments: [{ title: "Design", url: "https://figma.com/x" }],
    });
  });

  it("degrades a null description and a missing attachment connection to empty", async () => {
    const impl = fakeFetch({ issues: { nodes: [{ description: null }] } });
    expect(await getIssueContent("key", "RIC-46", impl)).toEqual({ description: "", attachments: [] });
  });

  it("drops attachments with no url and defaults a missing title", async () => {
    const impl = fakeFetch({ issues: { nodes: [{
      description: "",
      attachments: { nodes: [{ title: "no url" }, { url: "https://example.com/a" }] },
    }] } });
    expect((await getIssueContent("key", "RIC-46", impl)).attachments)
      .toEqual([{ title: "", url: "https://example.com/a" }]);
  });

  it("throws when the issue does not exist", async () => {
    const impl = fakeFetch({ issues: { nodes: [] } });
    await expect(getIssueContent("key", "RIC-999", impl)).rejects.toThrow("issue not found");
  });

  it("asks for the attachments in the same query as the description", async () => {
    const impl = fakeFetch({ issues: { nodes: [{ description: "" }] } });
    await getIssueContent("key", "RIC-46", impl);
    const body = (impl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string;
    expect(body).toContain("description");
    expect(body).toContain("attachments(first: 25)");
  });
});

describe("createIssue", () => {
  it("resolves team and project, then creates", async () => {
    const { impl, calls } = fakeFetchWithCalls([
      { teams: { nodes: [{ id: "team-1", key: "RIC" }] } },
      { projects: { nodes: [{ id: "proj-1", name: "Mojito" }] } },
      { issueCreate: { success: true, issue: { identifier: "RIC-200" } } },
    ]);
    const res = await createIssue("key", { teamKey: "RIC", title: "T", description: "D", projectName: "Mojito" }, impl);
    expect(res.identifier).toBe("RIC-200");
    expect(calls[2].body).toContain("proj-1");
  });
  it("creates without a project when projectName is null", async () => {
    const { impl, calls } = fakeFetchWithCalls([
      { teams: { nodes: [{ id: "team-1", key: "RIC" }] } },
      { issueCreate: { success: true, issue: { identifier: "RIC-201" } } },
    ]);
    const res = await createIssue("key", { teamKey: "RIC", title: "T", description: "D", projectName: null }, impl);
    expect(res.identifier).toBe("RIC-201");
    expect(calls).toHaveLength(2);
  });
  it("throws when the team is unknown", async () => {
    const { impl } = fakeFetchWithCalls([{ teams: { nodes: [] } }]);
    await expect(createIssue("key", { teamKey: "XX", title: "T", description: "D", projectName: null }, impl))
      .rejects.toThrow("team not found: XX");
  });
});

function fakeAssetFetch(opts: {
  ok?: boolean; status?: number; body?: Uint8Array; headers?: Record<string, string>;
}) {
  const headers = new Headers(opts.headers ?? {});
  const body = opts.body ?? new Uint8Array();
  return vi.fn(async () => ({
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    headers,
    arrayBuffer: async () => body.buffer,
  })) as unknown as typeof fetch;
}

describe("downloadLinearAsset", () => {
  it("sends the API key and returns the bytes with a normalized content type", async () => {
    const f = fakeAssetFetch({
      body: new Uint8Array([1, 2, 3]),
      headers: { "content-type": "image/png; charset=binary", "content-length": "3" },
    });
    const got = await downloadLinearAsset("k", "https://uploads.linear.app/a/b/c.png", 1000, f);
    expect(got.contentType).toBe("image/png");
    expect([...got.bytes]).toEqual([1, 2, 3]);
    const init = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(init.headers.Authorization).toBe("k");
  });

  it("throws on a non-2xx response", async () => {
    const f = fakeAssetFetch({ ok: false, status: 404 });
    await expect(downloadLinearAsset("k", "https://uploads.linear.app/x", 1000, f))
      .rejects.toThrow("404");
  });

  it("rejects an oversized asset from content-length without reading the body", async () => {
    const arrayBuffer = vi.fn(async () => new Uint8Array(1).buffer);
    const f = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-length": "5000" }),
      arrayBuffer,
    })) as unknown as typeof fetch;
    await expect(downloadLinearAsset("k", "https://uploads.linear.app/x", 1000, f))
      .rejects.toThrow("too large");
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("rejects an oversized body even when content-length lies", async () => {
    const f = fakeAssetFetch({ body: new Uint8Array(2000), headers: { "content-length": "1" } });
    await expect(downloadLinearAsset("k", "https://uploads.linear.app/x", 1000, f))
      .rejects.toThrow("too large");
  });

  it("degrades a missing content-type to an empty string", async () => {
    const f = fakeAssetFetch({ body: new Uint8Array([9]) });
    expect((await downloadLinearAsset("k", "https://uploads.linear.app/x", 1000, f)).contentType).toBe("");
  });

  it("refuses to send the API key to another host", async () => {
    const f = fakeAssetFetch({});
    await expect(downloadLinearAsset("k", "https://evil.com/a.png", 1000, f)).rejects.toThrow("refusing");
    expect(f).not.toHaveBeenCalled();
  });

  it("refuses a userinfo-smuggled host", async () => {
    const f = fakeAssetFetch({});
    await expect(downloadLinearAsset("k", "https://uploads.linear.app@evil.com/a.png", 1000, f))
      .rejects.toThrow("refusing");
    expect(f).not.toHaveBeenCalled();
  });

  it("refuses a plaintext http asset URL", async () => {
    const f = fakeAssetFetch({});
    await expect(downloadLinearAsset("k", "http://uploads.linear.app/a.png", 1000, f))
      .rejects.toThrow("refusing");
    expect(f).not.toHaveBeenCalled();
  });
});
