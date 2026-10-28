import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { describe, expect, it, vi } from "vitest";
// The pty gateway behind /ws/pty loads node-pty's native binding; nothing here spawns one.
vi.mock("node-pty", () => ({ spawn: vi.fn() }));
import type { WebSocketServer } from "ws";
import { openDb } from "../../src/db/db";
import { SessionsRepo } from "../../src/db/sessions";
import { EventBus } from "../../src/events/bus";
import { handleUpgrade } from "../../src/ws/upgrade";

const TOKEN = "tok";

function setup() {
  const sessions = new SessionsRepo(openDb(":memory:"));
  sessions.insert({
    id: "mj-RIC-1",
    kind: "ticket",
    project: "Web",
    ticket: "RIC-1",
    cwd: "/repo/web",
    model: "opus",
    effort: "high",
    brainstorming: false,
    state: "running",
    alert: null,
    createdAt: 1,
    lastEventAt: 1,
  });
  const socket = { destroy: vi.fn() };
  const wss = { handleUpgrade: vi.fn() };
  const deps = { token: TOKEN, wss: wss as unknown as WebSocketServer, sessions, bus: new EventBus() };
  const upgrade = (url: string) =>
    handleUpgrade({ url, headers: {} } as IncomingMessage, socket as unknown as Duplex, Buffer.alloc(0), deps);
  return { socket, wss, upgrade };
}

describe("handleUpgrade", () => {
  it("accepts /ws/events with the right token", () => {
    const { socket, wss, upgrade } = setup();
    upgrade(`/ws/events?token=${TOKEN}`);
    expect(wss.handleUpgrade).toHaveBeenCalled();
    expect(socket.destroy).not.toHaveBeenCalled();
  });

  it("accepts /ws/pty/<id> for a known mj- session", () => {
    const { socket, wss, upgrade } = setup();
    upgrade(`/ws/pty/mj-RIC-1?token=${TOKEN}`);
    expect(wss.handleUpgrade).toHaveBeenCalled();
    expect(socket.destroy).not.toHaveBeenCalled();
  });

  it.each([
    ["a wrong token", "/ws/events?token=nope"],
    ["no token", "/ws/events"],
    ["a pty path with no id", `/ws/pty/?token=${TOKEN}`],
    ["a bare pty path", `/ws/pty?token=${TOKEN}`],
    ["an id outside the mj- prefix", `/ws/pty/RIC-1?token=${TOKEN}`],
    ["an mj- id with no session row", `/ws/pty/mj-RIC-2?token=${TOKEN}`],
    ["a nested pty path", `/ws/pty/mj-RIC-1/x?token=${TOKEN}`],
    ["a path that is neither", `/ws/other?token=${TOKEN}`],
    ["an /api path", `/api/health?token=${TOKEN}`],
  ])("destroys the socket for %s", (_label, url) => {
    const { socket, wss, upgrade } = setup();
    upgrade(url);
    expect(socket.destroy).toHaveBeenCalled();
    expect(wss.handleUpgrade).not.toHaveBeenCalled();
  });

  it("destroys the socket when the url cannot be decoded", () => {
    const { socket, wss, upgrade } = setup();
    upgrade(`/ws/pty/%E0%A4%A?token=${TOKEN}`);
    expect(socket.destroy).toHaveBeenCalled();
    expect(wss.handleUpgrade).not.toHaveBeenCalled();
  });
});
