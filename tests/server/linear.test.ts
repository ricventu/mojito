import { describe, it, expect, vi } from "vitest";
import { listOpenIssues, getIssueStatus, getIssueRef, setIssueStatus, setIssueAssignee, postComment, uploadImage } from "@/server/linear";

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
            state: { name: "To Review", type: "started" },
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
      statusName: "To Review",
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
      { team: { states: { nodes: [{ id: "s1", name: "To Code" }, { id: "s2", name: "To Merge" }] } } },
      { issueUpdate: { success: true } },
    ]);
    await setIssueStatus("k", "RIC-110", "To Merge", f);
    const updateCall = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[2][1] as { body: string };
    expect(updateCall.body).toContain("issueUpdate");
    expect(updateCall.body).toContain("s2");
    expect(updateCall.body).toContain("issue-uuid");
  });

  it("throws when the target state does not exist in the team", async () => {
    const f = seqFetch([
      { issues: { nodes: [{ id: "issue-uuid", state: { name: "To QA" }, team: { id: "team-uuid" } }] } },
      { team: { states: { nodes: [{ id: "s1", name: "To Code" }] } } },
    ]);
    await expect(setIssueStatus("k", "RIC-110", "To Merge", f)).rejects.toThrow(/To Merge/);
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

  it("posts a comment on the resolved issue node", async () => {
    const f = seqFetch([
      { issues: { nodes: [{ id: "issue-uuid", state: { name: "To QA" }, team: { id: "team-uuid" } }] } },
      { commentCreate: { success: true } },
    ]);
    await postComment("k", "RIC-110", "QA rejected — nope", f);
    const commentCall = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[1][1] as { body: string };
    expect(commentCall.body).toContain("commentCreate");
    expect(commentCall.body).toContain("issue-uuid");
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
