import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import type { BoardTickets, EventSocket, MojitoEvent, PeerSnapshot, ProjectRow, SessionMeta } from "@mojito/shared";
import type { SessionsRepo } from "../../src/db/sessions";
import { EventBus } from "../../src/events/bus";
import { PeerLink } from "../../src/peers/link";
import { handleUpgrade } from "../../src/ws/upgrade";

const PEER = { name: "mac", url: "https://mac.t.ts.net" };

const session = (id: string, over: Partial<SessionMeta> = {}): SessionMeta => ({
  id,
  kind: "ticket",
  project: "Ios",
  ticket: null,
  cwd: "/repo/ios",
  model: "opus",
  effort: "high",
  state: "running",
  alert: null,
  createdAt: 1,
  lastEventAt: 1,
  hidden: false,
  title: null,
  ...over,
});

const running = session("mj-RIC-7", { ticket: "RIC-7" });
const ended = session("mj-RIC-9", { ticket: "RIC-9", state: "ended" });
const projects: ProjectRow[] = [{ name: "Ios", path: "/Users/me/ios", teamKey: "RIC" }];
const ticket = (identifier: string, title: string) => ({
  identifier,
  title,
  url: `https://linear.app/${identifier}`,
  statusName: "Todo",
  statusType: "unstarted",
  project: "Ios",
  labels: [],
  assignedToMe: true,
});
const board = (...tickets: ReturnType<typeof ticket>[]): BoardTickets => ({ tickets, fetchedAt: 1, stale: false, error: null });

type Answer = () => Response | Promise<Response>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** The peer's API: one answer per path, replaceable mid-test. */
function fakePeer() {
  const answers: Record<string, Answer> = {
    "/api/sessions": () => json([running, ended]),
    "/api/projects": () => json(projects),
    "/api/tickets": () => json(board(ticket("RIC-7", "Ship it"), ticket("RIC-8", "Not running"))),
  };
  const fetch = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const answer = answers[path];
    if (!answer) throw new Error(`unexpected fetch ${path}`);
    return answer();
  });
  return { answers, fetch, calls: (path: string) => fetch.mock.calls.filter(([u]) => new URL(String(u)).pathname === path) };
}

/** Sockets driven by hand; each dial makes a new one. */
function fakeSockets() {
  const sockets: (EventSocket & { closed: boolean; url: string })[] = [];
  const reports: ((problem: string) => void)[] = [];
  const connect = vi.fn((url: string, report: (problem: string) => void = () => {}) => {
    reports.push(report);
    const s = {
      url,
      closed: false,
      onopen: null,
      onmessage: null,
      onclose: null,
      close() {
        this.closed = true;
      },
    } as EventSocket & { closed: boolean; url: string };
    sockets.push(s);
    return s;
  });
  const last = () => sockets[sockets.length - 1];
  return {
    sockets,
    connect,
    open: () => last().onopen?.(),
    deliver: (e: MojitoEvent) => last().onmessage?.({ data: JSON.stringify(e) }),
    drop: () => last().onclose?.(),
    /** What the real socket says about a dial that failed (`ws`'s error message). */
    report: (problem: string) => reports[reports.length - 1](problem),
  };
}

/** Collects scheduled retries instead of waiting for them. */
function fakeClock() {
  const pending: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  const schedule = (fn: () => void, ms: number) => {
    const entry = { fn, ms, cancelled: false };
    pending.push(entry);
    return () => {
      entry.cancelled = true;
    };
  };
  const runAll = () => {
    for (const e of pending.splice(0)) if (!e.cancelled) e.fn();
  };
  return { pending, schedule, runAll };
}

function setup(over: { token?: string; readTimeoutMs?: number } = {}) {
  const bus = new EventBus();
  const updates: PeerSnapshot[] = [];
  bus.subscribe((e) => {
    if (e.type === "peers.updated") updates.push(e.peer);
  });
  const peer = fakePeer();
  const ws = fakeSockets();
  const clock = fakeClock();
  const link = new PeerLink({
    peer: PEER,
    token: over.token ?? "tok",
    bus,
    fetch: peer.fetch as unknown as typeof fetch,
    connect: ws.connect,
    schedule: clock.schedule,
    readTimeoutMs: over.readTimeoutMs,
  });
  return { bus, updates, peer, ws, clock, link };
}

/** Opens the socket and waits for the three reads to land. */
async function connected(s: ReturnType<typeof setup>) {
  s.link.start();
  s.ws.open();
  await vi.waitFor(() => expect(s.link.snapshot().online).toBe(true));
}

const offline: PeerSnapshot = { ...PEER, online: false, sessions: [], projects: [], ticketTitles: {} };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PeerLink", () => {
  it("dials the peer's event socket with the token and reads nothing before it opens", () => {
    const s = setup({ token: "a+b=" });
    s.link.start();
    expect(s.ws.connect).toHaveBeenCalledWith("wss://mac.t.ts.net/ws/events?token=a%2Bb%3D", expect.any(Function));
    expect(s.peer.fetch).not.toHaveBeenCalled();
    expect(s.link.snapshot()).toEqual(offline);
    expect(s.link.peer).toEqual(PEER);
  });

  it("dials ws:// for an http peer", () => {
    const bus = new EventBus();
    const ws = fakeSockets();
    const link = new PeerLink({ peer: { name: "127.0.0.1", url: "http://127.0.0.1:3200" }, token: "t", bus, connect: ws.connect, schedule: fakeClock().schedule });
    link.start();
    expect(ws.connect).toHaveBeenCalledWith("ws://127.0.0.1:3200/ws/events?token=t", expect.any(Function));
  });

  it("on open reads sessions, projects and tickets into one online snapshot", async () => {
    const s = setup();
    await connected(s);
    expect(s.link.snapshot()).toEqual({
      ...PEER,
      online: true,
      sessions: [running],
      projects: ["Ios"],
      ticketTitles: { "RIC-7": "Ship it" },
    });
    expect(s.updates).toEqual([s.link.snapshot()]);
    for (const path of ["/api/sessions", "/api/projects", "/api/tickets"]) {
      const [[url, init]] = s.peer.calls(path);
      expect(String(url)).toBe(`https://mac.t.ts.net${path}`);
      expect(new Headers(init?.headers).get("x-mojito-token")).toBe("tok");
    }
  });

  it("start() returns before any read resolves", () => {
    const s = setup();
    s.peer.answers["/api/sessions"] = () => new Promise<Response>(() => {});
    s.link.start();
    s.ws.open();
    expect(s.link.snapshot().online).toBe(false);
  });

  it("session events patch the snapshot, each emitting it", async () => {
    const s = setup();
    await connected(s);
    const other = session("mj-x-a1b2c3", { kind: "claude", project: null });
    s.ws.deliver({ type: "session.updated", session: other });
    expect(s.link.snapshot().sessions).toEqual([running, other]);
    const waiting = { ...running, state: "needs-input" as const };
    s.ws.deliver({ type: "session.updated", session: waiting });
    expect(s.link.snapshot().sessions).toEqual([waiting, other]);
    s.ws.deliver({ type: "session.removed", id: other.id });
    expect(s.link.snapshot().sessions).toEqual([waiting]);
    expect(s.updates).toHaveLength(4);
    expect(s.updates[3]).toEqual(s.link.snapshot());
  });

  it("a session that ends leaves the snapshot at once", async () => {
    const s = setup();
    await connected(s);
    s.ws.deliver({ type: "session.updated", session: { ...running, state: "ended" } });
    expect(s.link.snapshot().sessions).toEqual([]);
    expect(s.link.snapshot().ticketTitles).toEqual({});
  });

  it("tickets.changed re-reads the tickets", async () => {
    const s = setup();
    await connected(s);
    s.peer.answers["/api/tickets"] = () => json(board(ticket("RIC-7", "Ship it now")));
    s.ws.deliver({ type: "tickets.changed" });
    await vi.waitFor(() => expect(s.link.snapshot().ticketTitles).toEqual({ "RIC-7": "Ship it now" }));
    expect(s.peer.calls("/api/tickets")).toHaveLength(2);
    expect(s.updates.at(-1)).toEqual(s.link.snapshot());
  });

  it("projects.changed re-reads the projects", async () => {
    const s = setup();
    await connected(s);
    s.peer.answers["/api/projects"] = () => json([...projects, { name: "Mac", path: "/Users/me/mac", teamKey: "RIC" }]);
    s.ws.deliver({ type: "projects.changed" });
    await vi.waitFor(() => expect(s.link.snapshot().projects).toEqual(["Ios", "Mac"]));
  });

  it("other events change nothing and emit nothing", async () => {
    const s = setup();
    await connected(s);
    s.ws.deliver({ type: "settings.updated" });
    s.ws.deliver({ type: "peers.updated", peer: offline });
    expect(s.updates).toHaveLength(1);
  });

  it("a failing read closes the socket after a backoff and stays offline", async () => {
    const s = setup();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    s.peer.answers["/api/projects"] = () => json({ error: "boom" }, 500);
    s.link.start();
    s.ws.open();
    await vi.waitFor(() => expect(s.clock.pending.map((p) => p.ms)).toEqual([1000]));
    expect(s.ws.sockets[0].closed).toBe(false);
    s.clock.runAll();
    expect(s.ws.sockets[0].closed).toBe(true);
    expect(s.link.snapshot()).toEqual(offline);
    expect(String(error.mock.calls[0][0])).toMatch(/^mac: /);
  });

  it("reads that keep failing back off further each time, logging once", async () => {
    const s = setup();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    s.peer.answers["/api/projects"] = () => json({ error: "boom" }, 500);
    s.link.start();
    s.ws.open();
    await vi.waitFor(() => expect(s.clock.pending.map((p) => p.ms)).toEqual([1000]));
    s.clock.runAll(); // the close
    s.ws.drop();
    s.clock.runAll(); // the stream's redial (its own backoff restarted on the open)
    s.ws.open();
    await vi.waitFor(() => expect(s.clock.pending.map((p) => p.ms)).toEqual([2000]));
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("a rejected token says so", async () => {
    const s = setup();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    s.peer.answers["/api/sessions"] = () => json({ error: "unauthorized" }, 401);
    s.link.start();
    s.ws.open();
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith("mac: token rejected (401)"));
    expect(s.link.snapshot().online).toBe(false);
  });

  it("a dial's problem is logged once per offline stretch", async () => {
    const s = setup();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    s.link.start();
    s.ws.report("Unexpected server response: 401");
    s.ws.drop();
    s.clock.runAll();
    s.ws.report("Unexpected server response: 401");
    s.ws.drop();
    expect(error.mock.calls).toEqual([["mac: token rejected (401)"]]);
    s.clock.runAll();
    s.ws.open();
    await vi.waitFor(() => expect(s.link.snapshot().online).toBe(true));
    s.ws.drop();
    s.clock.runAll();
    s.ws.report("connect ECONNREFUSED 100.64.0.2:443");
    expect(error.mock.calls).toEqual([["mac: token rejected (401)"], ["mac: connect ECONNREFUSED 100.64.0.2:443"]]);
  });

  it("a read that does not answer in time counts as a failure", async () => {
    const s = setup({ readTimeoutMs: 20 });
    vi.spyOn(console, "error").mockImplementation(() => {});
    s.peer.answers["/api/sessions"] = () => new Promise<Response>(() => {});
    s.peer.fetch.mockImplementation(async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path !== "/api/sessions") return s.peer.answers[path]();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    });
    s.link.start();
    s.ws.open();
    await vi.waitFor(() => expect(s.clock.pending.map((p) => p.ms)).toEqual([1000]));
    s.clock.runAll();
    expect(s.ws.sockets[0].closed).toBe(true);
    expect(s.link.snapshot().online).toBe(false);
  });

  it("a close empties the snapshot, emits once and schedules a retry", async () => {
    const s = setup();
    await connected(s);
    s.ws.drop();
    expect(s.link.snapshot()).toEqual(offline);
    expect(s.updates).toHaveLength(2);
    expect(s.updates[1]).toEqual(offline);
    expect(s.clock.pending).toHaveLength(1);
  });

  it("a close while already offline and empty emits nothing", () => {
    const s = setup();
    s.link.start();
    s.ws.drop();
    expect(s.updates).toEqual([]);
    expect(s.clock.pending).toHaveLength(1);
  });

  it("reads that land after the socket closed are dropped", async () => {
    const s = setup();
    let release: (r: Response) => void = () => {};
    s.peer.answers["/api/sessions"] = () => new Promise<Response>((r) => (release = r));
    s.link.start();
    s.ws.open();
    await vi.waitFor(() => expect(s.peer.calls("/api/sessions")).toHaveLength(1));
    s.ws.drop();
    release(json([running]));
    await new Promise((r) => setTimeout(r, 10));
    expect(s.link.snapshot()).toEqual(offline);
  });

  it("reconnects through the retry and reads again", async () => {
    const s = setup();
    await connected(s);
    s.ws.drop();
    s.clock.runAll();
    expect(s.ws.sockets).toHaveLength(2);
    s.ws.open();
    await vi.waitFor(() => expect(s.link.snapshot().online).toBe(true));
  });

  it("a dial that throws is a close: retried, never thrown out of start()", () => {
    const s = setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    s.ws.connect.mockImplementationOnce(() => {
      throw new Error("bad url");
    });
    expect(() => s.link.start()).not.toThrow();
    return vi.waitFor(() => expect(s.clock.pending).toHaveLength(1));
  });

  it("stop() ends the retry loop", async () => {
    const s = setup();
    await connected(s);
    s.ws.drop();
    s.link.stop();
    s.clock.runAll();
    expect(s.ws.sockets).toHaveLength(1);
  });
});

describe("PeerLink over a real socket", () => {
  it("logs a peer that refuses its token as a rejected token", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const server = createServer();
    const wss = new WebSocketServer({ noServer: true });
    const bus = new EventBus();
    server.on("upgrade", (req, socket, head) =>
      handleUpgrade(req, socket, head, { token: "the-peer's", wss, sessions: {} as SessionsRepo, bus }),
    );
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as AddressInfo;
    const link = new PeerLink({ peer: { name: "127.0.0.1", url: `http://127.0.0.1:${port}` }, token: "ours", bus, schedule: () => () => {} });
    try {
      link.start();
      await vi.waitFor(() => expect(error).toHaveBeenCalledWith("127.0.0.1: token rejected (401)"));
      expect(link.snapshot().online).toBe(false);
    } finally {
      link.stop();
      wss.close();
      await new Promise((r) => server.close(r));
    }
  });
});
