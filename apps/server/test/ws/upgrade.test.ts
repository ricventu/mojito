import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { describe, expect, it, vi } from "vitest";
// The pty gateway behind /ws/pty loads node-pty's native binding; nothing here spawns one.
vi.mock("node-pty", () => ({ spawn: vi.fn() }));
vi.mock("../../src/ws/pty", () => ({ attachPty: vi.fn() }));
import { SESSION_GONE_CODE } from "@mojito/shared";
import type { WebSocketServer } from "ws";
import { openDb } from "../../src/db/db";
import { SessionsRepo } from "../../src/db/sessions";
import { EventBus } from "../../src/events/bus";
import type { MojitoEvent } from "@mojito/shared";
import { attachPty } from "../../src/ws/pty";
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
    state: "running",
    alert: null,
    createdAt: 1,
    lastEventAt: 1,
    hidden: false,
    title: null,
  });
  vi.mocked(attachPty).mockClear();
  const socket = { destroy: vi.fn() };
  // The accepted socket: handleUpgrade hands it straight to the callback, as `ws` does once
  // the handshake is written.
  const ws = { on: vi.fn(), send: vi.fn(), close: vi.fn() };
  const wss = { handleUpgrade: vi.fn((_req, _socket, _head, cb: (w: typeof ws) => void) => cb(ws)) };
  const bus = new EventBus();
  const events: MojitoEvent[] = [];
  bus.subscribe((e) => events.push(e));
  const deps = { token: TOKEN, wss: wss as unknown as WebSocketServer, sessions, bus, now: () => 77 };
  const upgrade = (url: string) =>
    handleUpgrade({ url, headers: {} } as IncomingMessage, socket as unknown as Duplex, Buffer.alloc(0), deps);
  return { socket, wss, ws, upgrade, sessions, events };
}

describe("handleUpgrade", () => {
  it("accepts /ws/events with the right token, under the heartbeat", () => {
    const { socket, wss, ws, upgrade } = setup();
    upgrade(`/ws/events?token=${TOKEN}`);
    expect(wss.handleUpgrade).toHaveBeenCalled();
    expect(socket.destroy).not.toHaveBeenCalled();
    expect(ws.on).toHaveBeenCalledWith("pong", expect.any(Function));
    expect(ws.close).not.toHaveBeenCalled();
  });

  it("attaches /ws/pty/<id> for a known mj- session, under the heartbeat", () => {
    const { socket, wss, ws, upgrade } = setup();
    upgrade(`/ws/pty/mj-RIC-1?token=${TOKEN}`);
    expect(wss.handleUpgrade).toHaveBeenCalled();
    expect(socket.destroy).not.toHaveBeenCalled();
    expect(attachPty).toHaveBeenCalledWith(ws, "mj-RIC-1", { onGone: expect.any(Function) });
    expect(ws.on).toHaveBeenCalledWith("pong", expect.any(Function));
  });

  it("wires the gateway's onGone to mark the row ended and tell every board", () => {
    const { upgrade, sessions, events } = setup();
    upgrade(`/ws/pty/mj-RIC-1?token=${TOKEN}`);
    const { onGone } = vi.mocked(attachPty).mock.calls[0][2]!;
    onGone!("mj-RIC-1");
    expect(sessions.get("mj-RIC-1")).toMatchObject({ state: "ended", alert: null, lastEventAt: 77 });
    expect(events).toEqual([{ type: "session.updated", session: sessions.get("mj-RIC-1") }]);
    // Already ended: nothing more to say.
    onGone!("mj-RIC-1");
    expect(events).toHaveLength(1);
  });

  // A destroyed handshake is a bare 1006 to the browser, which it retries every 1.5s forever;
  // 4404 is the close its reconnect loop stops on.
  it("closes an mj- id with no session row with SESSION_GONE_CODE, without attaching", () => {
    const { socket, wss, ws, upgrade } = setup();
    upgrade(`/ws/pty/mj-RIC-2?token=${TOKEN}`);
    expect(wss.handleUpgrade).toHaveBeenCalled();
    expect(socket.destroy).not.toHaveBeenCalled();
    expect(ws.close).toHaveBeenCalledWith(SESSION_GONE_CODE, expect.any(String));
    expect(attachPty).not.toHaveBeenCalled();
  });

  it.each([
    ["a wrong token", "/ws/events?token=nope"],
    ["no token", "/ws/events"],
    ["a pty path with no id", `/ws/pty/?token=${TOKEN}`],
    ["a bare pty path", `/ws/pty?token=${TOKEN}`],
    ["an id outside the mj- prefix", `/ws/pty/RIC-1?token=${TOKEN}`],
    ["an mj- id with no session row but a wrong token", "/ws/pty/mj-RIC-2?token=nope"],
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
    expect(attachPty).not.toHaveBeenCalled();
  });
});
