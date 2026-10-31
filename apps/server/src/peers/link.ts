import {
  openEventStream,
  retryDelay,
  type BoardTickets,
  type EventSocket,
  type MojitoEvent,
  type PeerSnapshot,
  type ProjectRow,
  type Schedule,
  type SessionMeta,
} from "@mojito/shared";
import WebSocket from "ws";
import type { PeerConfig } from "../config";
import type { EventBus } from "../events/bus";

export interface PeerLinkDeps {
  peer: PeerConfig;
  token: string;
  /** Where `peers.updated` goes: this instance's own bus. */
  bus: EventBus;
  fetch?: typeof fetch;
  /** Dials the socket; `report` is told why a dial failed (`ws`'s error message). */
  connect?: (url: string, report: (problem: string) => void) => EventSocket;
  schedule?: Schedule;
  /** Each read's limit. Default 10 s. */
  readTimeoutMs?: number;
}

const READ_TIMEOUT_MS = 10_000;
/** How often the default socket pings the peer; a peer silent for a whole interval is dropped. */
const PING_MS = 30_000;

const defaultSchedule: Schedule = (fn, ms) => {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
};

/**
 * The default socket: `ws`, pinging the peer. A Mac that goes to sleep sends no close, and its
 * sessions would sit in every sidebar as live until TCP gave up — so a peer that does not pong
 * within an interval is terminated, which is a close.
 */
function wsConnect(url: string, report: (problem: string) => void): EventSocket {
  const ws = new WebSocket(url);
  const socket: EventSocket = { onopen: null, onmessage: null, onclose: null, close: () => ws.terminate() };
  let alive = true;
  const ping = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    if (ws.readyState === WebSocket.OPEN) ws.ping();
  }, PING_MS);
  ws.on("pong", () => (alive = true));
  ws.on("open", () => socket.onopen?.());
  ws.on("message", (data) => {
    alive = true;
    socket.onmessage?.({ data: String(data) });
  });
  ws.on("close", () => {
    clearInterval(ping);
    socket.onclose?.();
  });
  // A failed dial is an error and then a close: the close is what the stream acts on, the error
  // only says why (a peer refusing the token answers the handshake with 401).
  ws.on("error", (err) => report(err.message));
  return socket;
}

/** A dial's or a read's failure, as the log line says it. */
function describeProblem(problem: string): string {
  return /\b401\b/.test(problem) ? "token rejected (401)" : problem;
}

/** A socket that never opened: it closes on the next tick, once the stream has set its handlers. */
function deadSocket(): EventSocket {
  const socket: EventSocket = { onopen: null, onmessage: null, onclose: null, close: () => {} };
  queueMicrotask(() => socket.onclose?.());
  return socket;
}


/**
 * One peer, kept live: its `/ws/events` dialled with the shared backoff, and on every open its
 * sessions, projects and tickets read afresh; its session events then patch the snapshot.
 * Every change is emitted on this instance's bus as `peers.updated`. A close empties it —
 * a sleeping machine's last-known states would lie. Events that arrive while the reads are in
 * flight patch the snapshot and the reads then replace it: the race the web client accepts too.
 */
export class PeerLink {
  readonly peer: PeerConfig;
  private readonly deps: PeerLinkDeps;
  private online = false;
  private sessions: SessionMeta[] = [];
  private projects: string[] = [];
  private titles = new Map<string, string>();
  /** Bumped on every open and close: a read that lands under another generation is dropped. */
  private generation = 0;
  private socket: EventSocket | null = null;
  private dispose: (() => void) | null = null;
  /** One log line per offline stretch: a peer asleep for a night is not 2 000 lines. */
  private logged = false;
  /**
   * Reads that failed in a row. The stream's own backoff restarts on every open, so a peer
   * whose socket opens but whose reads fail would be re-dialled every second; the close waits
   * `retryDelay(readFailures)` instead.
   */
  private readFailures = 0;
  private cancelClose: (() => void) | null = null;

  constructor(deps: PeerLinkDeps) {
    this.deps = deps;
    this.peer = deps.peer;
  }

  start(): void {
    if (this.dispose) return;
    const url = `${this.peer.url.replace(/^http/, "ws")}/ws/events?token=${encodeURIComponent(this.deps.token)}`;
    this.dispose = openEventStream(() => this.dial(url), { onEvent: (e) => this.onEvent(e), onConnect: () => void this.load() }, this.deps.schedule ?? defaultSchedule);
  }

  stop(): void {
    this.cancelClose?.();
    this.cancelClose = null;
    this.dispose?.();
    this.dispose = null;
  }

  snapshot(): PeerSnapshot {
    const ticketTitles: Record<string, string> = {};
    for (const s of this.sessions) {
      const title = s.ticket === null ? undefined : this.titles.get(s.ticket);
      if (s.ticket !== null && title !== undefined) ticketTitles[s.ticket] = title;
    }
    return {
      name: this.peer.name,
      url: this.peer.url,
      online: this.online,
      sessions: [...this.sessions],
      projects: [...this.projects],
      ticketTitles,
    };
  }

  /** The stream's socket, wrapped so this link also learns of the close. */
  private dial(url: string): EventSocket {
    let inner: EventSocket;
    try {
      inner = (this.deps.connect ?? wsConnect)(url, (problem) => this.problem(problem));
    } catch (err) {
      this.problem(err instanceof Error ? err.message : String(err));
      inner = deadSocket();
    }
    const outer: EventSocket = { onopen: null, onmessage: null, onclose: null, close: () => inner.close() };
    inner.onopen = () => outer.onopen?.();
    inner.onmessage = (m) => outer.onmessage?.(m);
    inner.onclose = () => {
      this.closed();
      outer.onclose?.();
    };
    this.socket = outer;
    return outer;
  }

  private problem(problem: string): void {
    if (this.logged) return;
    this.logged = true;
    console.error(`${this.peer.name}: ${describeProblem(problem)}`);
  }

  private closed(): void {
    this.cancelClose?.();
    this.cancelClose = null;
    this.generation += 1;
    const changed = this.online || this.sessions.length > 0;
    this.online = false;
    this.sessions = [];
    this.projects = [];
    this.titles.clear();
    if (changed) this.emit();
  }

  private async load(): Promise<void> {
    const generation = ++this.generation;
    try {
      const [sessions, projects, tickets] = await Promise.all([
        this.read<SessionMeta[]>("/api/sessions"),
        this.read<ProjectRow[]>("/api/projects"),
        this.read<BoardTickets>("/api/tickets"),
      ]);
      if (generation !== this.generation) return;
      this.sessions = sessions.filter((s) => s.state !== "ended");
      this.projects = projects.map((p) => p.name);
      this.setTitles(tickets);
      this.online = true;
      this.logged = false;
      this.readFailures = 0;
      this.emit();
    } catch (err) {
      this.failed(err, generation);
    }
  }

  private async reread(what: "tickets" | "projects"): Promise<void> {
    const generation = this.generation;
    try {
      if (what === "tickets") {
        const tickets = await this.read<BoardTickets>("/api/tickets");
        if (generation !== this.generation) return;
        this.setTitles(tickets);
      } else {
        const projects = await this.read<ProjectRow[]>("/api/projects");
        if (generation !== this.generation) return;
        this.projects = projects.map((p) => p.name);
      }
      this.emit();
    } catch (err) {
      this.failed(err, generation);
    }
  }

  /**
   * A read that failed under the live generation drops the socket, after a wait that grows with
   * each failure in a row; reconnecting reads everything afresh.
   */
  private failed(err: unknown, generation: number): void {
    if (generation !== this.generation || this.cancelClose) return;
    this.problem(err instanceof Error ? err.message : String(err));
    this.readFailures += 1;
    const socket = this.socket;
    this.cancelClose = (this.deps.schedule ?? defaultSchedule)(() => {
      this.cancelClose = null;
      if (generation === this.generation) socket?.close();
    }, retryDelay(this.readFailures));
  }

  private async read<T>(path: string): Promise<T> {
    const res = await (this.deps.fetch ?? fetch)(`${this.peer.url}${path}`, {
      headers: { "x-mojito-token": this.deps.token },
      signal: AbortSignal.timeout(this.deps.readTimeoutMs ?? READ_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`${path} answered ${res.status}`);
    return (await res.json()) as T;
  }

  private setTitles(tickets: BoardTickets): void {
    this.titles = new Map(tickets.tickets.map((t) => [t.identifier, t.title]));
  }

  private onEvent(e: MojitoEvent): void {
    switch (e.type) {
      case "session.updated": {
        const rest = this.sessions.filter((s) => s.id !== e.session.id);
        if (e.session.state === "ended") this.sessions = rest;
        else {
          const at = this.sessions.findIndex((s) => s.id === e.session.id);
          this.sessions = at === -1 ? [...this.sessions, e.session] : this.sessions.map((s, i) => (i === at ? e.session : s));
        }
        this.emit();
        break;
      }
      case "session.removed":
        this.sessions = this.sessions.filter((s) => s.id !== e.id);
        this.emit();
        break;
      case "tickets.changed":
        void this.reread("tickets");
        break;
      case "projects.changed":
        void this.reread("projects");
        break;
    }
  }

  private emit(): void {
    this.deps.bus.emit({ type: "peers.updated", peer: this.snapshot() });
  }
}
