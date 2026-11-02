import { createServer, type Server } from "node:http";
import net, { type AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
// The pty gateway behind /ws/pty loads node-pty's native binding; nothing here spawns one.
vi.mock("node-pty", () => ({ spawn: vi.fn() }));
vi.mock("../../src/ws/pty", () => ({ attachPty: vi.fn() }));
import { SESSION_GONE_CODE } from "@mojito/shared";
import WebSocket, { WebSocketServer } from "ws";
import { openDb } from "../../src/db/db";
import { SessionsRepo } from "../../src/db/sessions";
import { EventBus } from "../../src/events/bus";
import { mirrorCode, peerPtyUrl, relayPeerPty } from "../../src/ws/peerPty";
import { handleUpgrade } from "../../src/ws/upgrade";

const TOKEN = "tok";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

function listening<T extends Server | WebSocketServer>(server: T): Promise<number> {
  return new Promise((resolve) => {
    const s = server as unknown as Server;
    s.listen(0, "127.0.0.1", () => resolve((s.address() as AddressInfo).port));
  });
}

// The fake peer: records each connection and what it receives.
async function fakePeer() {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  const port = await new Promise<number>((resolve) => wss.on("listening", () => resolve((wss.address() as AddressInfo).port)));
  closers.push(() => {
    for (const c of wss.clients) c.terminate();
    wss.close();
  });
  const urls: string[] = [];
  const conns: WebSocket[] = [];
  const connected: Array<() => void> = [];
  wss.on("connection", (ws, req) => {
    urls.push(req.url ?? "");
    conns.push(ws);
    connected.splice(0).forEach((f) => f());
  });
  const nextConn = async (): Promise<WebSocket> => {
    if (!conns.length) await new Promise<void>((resolve) => connected.push(resolve));
    return conns[0];
  };
  return { port, urls, conns, nextConn };
}

interface Opts {
  peerUrl: string;
  online?: boolean;
  dial?: (url: string) => Promise<WebSocket>;
}

// This instance: an http server whose upgrade runs handleUpgrade with a stubbed registry.
async function instance({ peerUrl, online = true, dial }: Opts) {
  const server = createServer();
  const wss = new WebSocketServer({ noServer: true });
  const sessions = new SessionsRepo(openDb(":memory:"));
  const sockets: Duplex[] = [];
  server.on("upgrade", (req, socket, head) => {
    sockets.push(socket);
    handleUpgrade(req, socket as Duplex, head, {
      token: TOKEN,
      wss,
      sessions,
      bus: new EventBus(),
      peers: { config: () => ({ name: "mac", url: peerUrl }), online: () => online },
      dial,
    });
  });
  const port = await listening(server);
  closers.push(() => {
    for (const c of wss.clients) c.terminate();
    wss.close();
    server.closeAllConnections();
    server.close();
  });
  return {
    port,
    sockets,
    connect: (id = "mj-a") => new WebSocket(`ws://127.0.0.1:${port}/ws/peers/mac/pty/${id}?token=${TOKEN}`),
  };
}

const opened = (ws: WebSocket) => new Promise<void>((resolve) => ws.once("open", () => resolve()));
const closedWith = (ws: WebSocket) =>
  new Promise<number>((resolve) => ws.once("close", (code) => resolve(code)));
const nextMessage = (ws: WebSocket) =>
  new Promise<{ data: Buffer; isBinary: boolean }>((resolve) =>
    ws.once("message", (data, isBinary) => resolve({ data: data as Buffer, isBinary })),
  );

describe("peerPtyUrl / mirrorCode", () => {
  it("builds the peer's gateway url", () => {
    expect(peerPtyUrl("https://mac.t.ts.net", "mj-a b", "t k")).toBe("wss://mac.t.ts.net/ws/pty/mj-a%20b?token=t%20k");
    expect(peerPtyUrl("http://127.0.0.1:8700", "mj-a", "t")).toBe("ws://127.0.0.1:8700/ws/pty/mj-a?token=t");
  });

  it("mirrors 1000 and 3000-4999, and turns anything else into 1011", () => {
    expect(mirrorCode(1000)).toBe(1000);
    expect(mirrorCode(SESSION_GONE_CODE)).toBe(4404);
    expect(mirrorCode(3000)).toBe(3000);
    expect(mirrorCode(4999)).toBe(4999);
    for (const code of [1001, 1005, 1006, 1011, 5000]) expect(mirrorCode(code)).toBe(1011);
  });
});

describe("the peer pty relay", () => {
  it("dials the peer's gateway with the shared token", async () => {
    const peer = await fakePeer();
    const { connect } = await instance({ peerUrl: `http://127.0.0.1:${peer.port}` });
    const browser = connect();
    await opened(browser);
    await peer.nextConn();
    expect(peer.urls).toEqual(["/ws/pty/mj-a?token=tok"]);
  });

  it("pipes frames both ways, keeping binary and text apart", async () => {
    const peer = await fakePeer();
    const { connect } = await instance({ peerUrl: `http://127.0.0.1:${peer.port}` });
    const browser = connect();
    await opened(browser);
    const upstream = await peer.nextConn();

    const keys = nextMessage(upstream);
    browser.send(Buffer.from([1, 2, 3]));
    const k = await keys;
    expect(k.isBinary).toBe(true);
    expect([...k.data]).toEqual([1, 2, 3]);

    const resize = nextMessage(upstream);
    browser.send(JSON.stringify({ resize: { cols: 120, rows: 40 } }));
    const r = await resize;
    expect(r.isBinary).toBe(false);
    expect(r.data.toString()).toBe('{"resize":{"cols":120,"rows":40}}');

    const out = nextMessage(browser);
    upstream.send("hello");
    const o = await out;
    expect(o.isBinary).toBe(false);
    expect(o.data.toString()).toBe("hello");
  });

  it("hands the peer's 4404 to the browser intact", async () => {
    const peer = await fakePeer();
    const { connect } = await instance({ peerUrl: `http://127.0.0.1:${peer.port}` });
    const browser = connect();
    await opened(browser);
    const upstream = await peer.nextConn();
    const closed = closedWith(browser);
    upstream.close(SESSION_GONE_CODE, "session gone");
    expect(await closed).toBe(4404);
  });

  it("tells the browser 1011 when the peer drops without a close", async () => {
    const peer = await fakePeer();
    const { connect } = await instance({ peerUrl: `http://127.0.0.1:${peer.port}` });
    const browser = connect();
    await opened(browser);
    const upstream = await peer.nextConn();
    const closed = closedWith(browser);
    upstream.terminate();
    expect(await closed).toBe(1011);
  });

  it("closes the peer with 1000 when the browser leaves", async () => {
    const peer = await fakePeer();
    const { connect } = await instance({ peerUrl: `http://127.0.0.1:${peer.port}` });
    const browser = connect();
    await opened(browser);
    const upstream = await peer.nextConn();
    const closed = closedWith(upstream);
    browser.close(1000);
    expect(await closed).toBe(1000);
  });

  it("answers an offline peer with 1011, without dialling it", async () => {
    const peer = await fakePeer();
    const { connect } = await instance({ peerUrl: `http://127.0.0.1:${peer.port}`, online: false });
    const browser = connect();
    await opened(browser);
    expect(await closedWith(browser)).toBe(1011);
    expect(peer.urls).toEqual([]);
  });

  it("answers a refused dial with 1011", async () => {
    // A port that was just free and is now closed.
    const probe = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    const port = await new Promise<number>((resolve) => probe.on("listening", () => resolve((probe.address() as AddressInfo).port)));
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    const { connect } = await instance({ peerUrl: `http://127.0.0.1:${port}` });
    const browser = connect();
    await opened(browser);
    expect(await closedWith(browser)).toBe(1011);
  });

  // The browser leaves while the peer is still being dialled: by closing its side, or by a reset
  // (node's http server has no `error` listener on an upgraded socket, so an unwatched reset is an
  // uncaught ECONNRESET). Either way the late upstream is closed and the socket is let go.
  it.each([
    ["half-closes", (c: net.Socket) => c.end()],
    ["resets", (c: net.Socket) => c.resetAndDestroy()],
    ["hangs up", (c: net.Socket) => c.destroy()],
  ])("closes an upstream that arrives after the browser %s mid-dial", async (_label, leave) => {
    const peer = await fakePeer();
    let resolveDial!: (ws: WebSocket) => void;
    const dialed = new Promise<WebSocket>((resolve) => {
      resolveDial = resolve;
    });
    let dialStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      dialStarted = resolve;
    });
    const inst = await instance({
      peerUrl: `http://127.0.0.1:${peer.port}`,
      dial: () => {
        dialStarted();
        return dialed;
      },
    });
    const client = net.connect(inst.port, "127.0.0.1");
    client.on("error", () => {});
    client.write(
      `GET /ws/peers/mac/pty/mj-a?token=${TOKEN} HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n` +
        "Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
    );
    await started;
    leave(client);
    // Let the server see the hang-up before the dial resolves.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const upstream = new WebSocket(`ws://127.0.0.1:${peer.port}/ws/pty/mj-a?token=tok`);
    await opened(upstream);
    const close = vi.spyOn(upstream, "close");
    resolveDial(upstream);
    await vi.waitFor(() => expect(close).toHaveBeenCalled());
    await vi.waitFor(() => expect(inst.sockets[0].destroyed).toBe(true));
  });

  it("terminates a peer that never answers a ping, and tells the browser 1011", async () => {
    const browserSide = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    closers.push(() => {
      for (const c of browserSide.clients) c.terminate();
      browserSide.close();
    });
    const browserPort = await new Promise<number>((resolve) =>
      browserSide.on("listening", () => resolve((browserSide.address() as AddressInfo).port)),
    );
    // The peer never pongs: autoPong off at the upstream's far end.
    const silent = new WebSocketServer({ port: 0, host: "127.0.0.1", autoPong: false } as never);
    closers.push(() => {
      for (const c of silent.clients) c.terminate();
      silent.close();
    });
    const silentPort = await new Promise<number>((resolve) =>
      silent.on("listening", () => resolve((silent.address() as AddressInfo).port)),
    );

    const relayed = new Promise<WebSocket>((resolve) => browserSide.on("connection", resolve));
    const browser = new WebSocket(`ws://127.0.0.1:${browserPort}`);
    const upstream = new WebSocket(`ws://127.0.0.1:${silentPort}`);
    await Promise.all([opened(browser), opened(upstream)]);
    const browserEnd = await relayed;
    const terminated = vi.spyOn(upstream, "terminate");
    const closed = closedWith(browser);
    relayPeerPty(browserEnd, upstream, { pingMs: 20 });
    expect(await closed).toBe(1011);
    expect(terminated).toHaveBeenCalled();
  });
});
