import { describe, expect, it, vi } from "vitest";
import { meta, setup } from "./setup";

describe("GET /api/sessions", () => {
  it("lists the sessions", async () => {
    const { req, sessions } = setup();
    sessions.insert(meta());
    const res = await req("/api/sessions");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([meta()]);
  });
});

describe("POST /api/sessions", () => {
  it("refuses an invalid ticket id before launching anything", async () => {
    const { req, launch } = setup();
    const res = await req("/api/sessions", {
      method: "POST",
      json: { kind: "ticket", ticket: "x", model: "opus", effort: "high" },
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/ticket/);
    expect(launch.newSession).not.toHaveBeenCalled();
  });

  it("refuses an unknown kind", async () => {
    const { req } = setup();
    const res = await req("/api/sessions", { method: "POST", json: { kind: "nope" } });
    expect(res.status).toBe(400);
  });

  it("launches a free session and answers 201 with it", async () => {
    const { req, launch, sessions } = setup();
    const res = await req("/api/sessions", { method: "POST", json: { kind: "shell", project: null } });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, any>;
    expect(body.session.id).toBe("mj-general-a1b2c3");
    expect(body).not.toHaveProperty("warning");
    expect(launch.newSession).toHaveBeenCalled();
    expect(sessions.get("mj-general-a1b2c3")?.state).toBe("running");
  });

  it("answers a refused launch with its status and error", async () => {
    const { req } = setup();
    const res = await req("/api/sessions", {
      method: "POST",
      json: { kind: "ticket", ticket: "RIC-9", model: "opus", effort: "high" },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "ticket not found: RIC-9" });
  });

  it("carries the session id of a conflict", async () => {
    const { req, linear, tickets, projects, sessions } = setup();
    projects.upsert({ name: "Web", path: "/repo/web", teamKey: "RIC" });
    linear.listOpenIssues.mockResolvedValue([
      { identifier: "RIC-1", title: "t", url: "", statusName: "Todo", statusType: "unstarted", project: "Web", labels: [], assignedToMe: false },
    ] as never);
    await tickets.refresh();
    sessions.insert(meta());
    const res = await req("/api/sessions", {
      method: "POST",
      json: { kind: "ticket", ticket: "RIC-1", model: "opus", effort: "high" },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "session already exists: mj-RIC-1", sessionId: "mj-RIC-1" });
  });

  it("answers a launch that throws with 500 and its message", async () => {
    const { req, launch } = setup();
    vi.mocked(launch.newSession).mockRejectedValue(new Error("tmux exploded"));
    const res = await req("/api/sessions", { method: "POST", json: { kind: "shell", project: null } });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "tmux exploded" });
  });
});

describe("POST /api/sessions/:id/resume", () => {
  it("resumes an ended session and answers 201 with its row", async () => {
    const { req, sessions, launch } = setup();
    sessions.insert(meta({ state: "ended", endReason: "other", claudeSessionId: "aaaa-1" }));
    const res = await req("/api/sessions/mj-RIC-1/resume", { method: "POST" });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { session: { state: string } }).session.state).toBe("starting");
    expect(launch.newSession).toHaveBeenCalledTimes(1);
  });

  it("answers the refusal's status with { error }", async () => {
    const { req, sessions } = setup();
    expect((await req("/api/sessions/mj-RIC-1/resume", { method: "POST" })).status).toBe(404);
    sessions.insert(meta({ state: "ended" }));
    const res = await req("/api/sessions/mj-RIC-1/resume", { method: "POST" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "no claude conversation was recorded for this session" });
  });
});

describe("DELETE /api/sessions/:id", () => {
  it("never kills: a live session is left as it is (claude is quit in its terminal)", async () => {
    const { req, sessions, events } = setup();
    sessions.insert(meta());
    const res = await req("/api/sessions/mj-RIC-1", { method: "DELETE" });
    expect(res.status).toBe(409);
    expect(sessions.get("mj-RIC-1")?.state).toBe("running");
    expect(events).toEqual([]);
  });

  describe("forgetting an ended session", () => {
    it("refuses to remove a session that has not ended", async () => {
      const { req, sessions, events, removeFile } = setup();
      sessions.insert(meta({ state: "running" }));
      const res = await req("/api/sessions/mj-RIC-1", { method: "DELETE" });
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: string }).error).toEqual(expect.any(String));
      expect(sessions.get("mj-RIC-1")).not.toBeNull();
      expect(events).toEqual([]);
      expect(removeFile).not.toHaveBeenCalled();
    });

    it("removes an ended session, its hook file, its images, and says so", async () => {
      const { req, sessions, events, removeFile } = setup();
      sessions.insert(meta({ state: "ended" }));
      const res = await req("/api/sessions/mj-RIC-1", { method: "DELETE" });
      expect(res.status).toBe(200);
      expect(sessions.get("mj-RIC-1")).toBeNull();
      expect(events).toEqual([{ type: "session.removed", id: "mj-RIC-1" }]);
      expect(removeFile).toHaveBeenCalledWith("/state/hooks/mj-RIC-1.json");
      expect(removeFile).toHaveBeenCalledWith("/state/images/mj-RIC-1");
    });

    it("still removes the row and the images when the hook file cannot be deleted", async () => {
      const { req, sessions, removeFile } = setup();
      sessions.insert(meta({ state: "ended" }));
      removeFile.mockImplementation((path) => {
        if (path.endsWith(".json")) throw new Error("ENOENT");
      });
      const res = await req("/api/sessions/mj-RIC-1", { method: "DELETE" });
      expect(res.status).toBe(200);
      expect(sessions.get("mj-RIC-1")).toBeNull();
      expect(removeFile).toHaveBeenCalledWith("/state/images/mj-RIC-1");
    });

    it("answers 404 for an unknown session", async () => {
      const { req, events } = setup();
      const res = await req("/api/sessions/mj-RIC-1", { method: "DELETE" });
      expect(res.status).toBe(404);
      expect(events).toEqual([]);
    });
  });
});
