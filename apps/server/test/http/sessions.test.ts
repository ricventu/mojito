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

describe("DELETE /api/sessions/:id", () => {
  it("kills a live session", async () => {
    const { req, sessions, closeSession } = setup();
    sessions.insert(meta());
    const res = await req("/api/sessions/mj-RIC-1", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(closeSession).toHaveBeenCalledWith("mj-RIC-1");
    expect(sessions.get("mj-RIC-1")?.state).toBe("ended");
  });

  it("answers 404 for an unknown session", async () => {
    const { req, closeSession } = setup();
    const res = await req("/api/sessions/mj-RIC-1", { method: "DELETE" });
    expect(res.status).toBe(404);
    expect(closeSession).not.toHaveBeenCalled();
  });

  it("answers 409 when claude will not leave, and keeps the session", async () => {
    const { req, sessions, closeSession } = setup();
    sessions.insert(meta());
    closeSession.mockResolvedValue({ closed: false });
    const res = await req("/api/sessions/mj-RIC-1", { method: "DELETE" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "claude did not exit: open the terminal" });
    expect(sessions.get("mj-RIC-1")?.state).toBe("running");
  });

  it("answers 500 when closing throws", async () => {
    const { req, sessions, closeSession } = setup();
    sessions.insert(meta());
    closeSession.mockRejectedValue(new Error("tmux gone mad"));
    const res = await req("/api/sessions/mj-RIC-1", { method: "DELETE" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "tmux gone mad" });
  });

  describe("?remove=1", () => {
    it("refuses to remove a session that has not ended", async () => {
      const { req, sessions, events, removeFile, closeSession } = setup();
      sessions.insert(meta({ state: "running" }));
      const res = await req("/api/sessions/mj-RIC-1?remove=1", { method: "DELETE" });
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: string }).error).toEqual(expect.any(String));
      expect(sessions.get("mj-RIC-1")).not.toBeNull();
      expect(events).toEqual([]);
      expect(removeFile).not.toHaveBeenCalled();
      expect(closeSession).not.toHaveBeenCalled();
    });

    it("removes an ended session, its hook file, and says so", async () => {
      const { req, sessions, events, removeFile, closeSession } = setup();
      sessions.insert(meta({ state: "ended" }));
      const res = await req("/api/sessions/mj-RIC-1?remove=1", { method: "DELETE" });
      expect(res.status).toBe(200);
      expect(sessions.get("mj-RIC-1")).toBeNull();
      expect(events).toEqual([{ type: "session.removed", id: "mj-RIC-1" }]);
      expect(removeFile).toHaveBeenCalledWith("/state/hooks/mj-RIC-1.json");
      expect(closeSession).not.toHaveBeenCalled();
    });

    it("still removes the row when the hook file cannot be deleted", async () => {
      const { req, sessions, removeFile } = setup();
      sessions.insert(meta({ state: "ended" }));
      removeFile.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      const res = await req("/api/sessions/mj-RIC-1?remove=1", { method: "DELETE" });
      expect(res.status).toBe(200);
      expect(sessions.get("mj-RIC-1")).toBeNull();
    });

    it("answers 404 for an unknown session", async () => {
      const { req, events } = setup();
      const res = await req("/api/sessions/mj-RIC-1?remove=1", { method: "DELETE" });
      expect(res.status).toBe(404);
      expect(events).toEqual([]);
    });
  });
});
