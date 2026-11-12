import type { PeerSnapshot, PeersAnswer, SessionMeta, TicketSummary } from "@mojito/shared";
import { byProjectName } from "@/lib/board";
import { withLaunched } from "@/lib/launch";

/**
 * A page of a peer's own client, logged in: its first-visit `?token=` handoff takes the token
 * this client already holds (every instance shares one), stores it and strips it from the url.
 * Only the sidebar band's ↗ uses it, in the same tab: a peer's sessions, git and docs open in
 * this client (`?host=`).
 */
export function peerHref(peer: Pick<PeerSnapshot, "url">, path: string, token: string): string {
  return `${peer.url}${path}?token=${encodeURIComponent(token)}`;
}

/** The tab title: this instance's name first, so a glance at the tab says whose board it is. */
export function appTitle(self: string | undefined): string {
  return self ? `${self} · Mojito` : "Mojito";
}

/** Where a ticket can run: `peer` null is this instance. */
export interface LaunchHost {
  name: string;
  peer: PeerSnapshot | null;
}

/**
 * This instance first (the ticket is on its board, so its project is mapped here), then every
 * online peer that maps the ticket's project — a peer with no checkout of it cannot run it.
 */
export function launchHosts(ticket: Pick<TicketSummary, "project">, self: string, peers: PeerSnapshot[]): LaunchHost[] {
  const project = ticket.project;
  const others = project === null ? [] : peers.filter((p) => p.online && p.projects.includes(project));
  return [{ name: self, peer: null }, ...others.map((p) => ({ name: p.name, peer: p }))];
}

/**
 * The projects a free session can start in: this instance's and every online peer's, once
 * each, in display order. A project only a peer maps is launchable there (`freeLaunchHosts`).
 */
export function freeLaunchProjects(selfProjects: string[], peers: PeerSnapshot[]): string[] {
  const online = peers.filter((p) => p.online).flatMap((p) => p.projects);
  return [...new Set([...selfProjects, ...online])].sort(byProjectName);
}

/**
 * Where a free session can run: the hosts that map its project, this instance first when it
 * does. General (`null`) needs no checkout — it starts in the home directory — so it runs on
 * this instance and every online peer.
 */
export function freeLaunchHosts(project: string | null, self: string, selfProjects: string[], peers: PeerSnapshot[]): LaunchHost[] {
  const maps = (projects: string[]) => project === null || projects.includes(project);
  const here = maps(selfProjects) ? [{ name: self, peer: null }] : [];
  const others = peers.filter((p) => p.online && maps(p.projects));
  return [...here, ...others.map((p) => ({ name: p.name, peer: p }))];
}

/** Whether a session on another instance is asking for input. */
export function waitingPeers(peers: PeerSnapshot[]): boolean {
  return peers.some((p) => p.sessions.some((s) => s.state === "needs-input"));
}

/**
 * A ticket already running on another instance (snapshots hold live sessions only). The ticket
 * sheet shows it instead of a Launch that would start a second agent on the same ticket.
 */
export function peerSessionForTicket(peers: PeerSnapshot[], ticket: string): { peer: PeerSnapshot; session: SessionMeta } | null {
  for (const peer of peers) {
    const session = peer.sessions.find((s) => s.kind === "ticket" && s.ticket === ticket);
    if (session) return { peer, session };
  }
  return null;
}

/** A session launched on `peerName`, into the cached answer, until its `peers.updated` arrives (`withLaunched`). */
export function withPeerSession(answer: PeersAnswer | undefined, peerName: string, session: SessionMeta): PeersAnswer | undefined {
  if (!answer || !answer.peers.some((p) => p.name === peerName)) return answer;
  return {
    ...answer,
    peers: answer.peers.map((p) => (p.name === peerName ? { ...p, sessions: withLaunched(p.sessions, session) ?? [] } : p)),
  };
}

/** `peers.updated` applied to the cached answer: the peer replaced in place, by name. */
export function replacePeer(answer: PeersAnswer | undefined, peer: PeerSnapshot): PeersAnswer | undefined {
  if (!answer || !answer.peers.some((p) => p.name === peer.name)) return answer;
  return { ...answer, peers: answer.peers.map((p) => (p.name === peer.name ? peer : p)) };
}
