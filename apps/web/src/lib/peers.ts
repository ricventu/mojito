import type { PeerSnapshot, PeersAnswer, TicketSummary } from "@mojito/shared";

/**
 * A page of a peer's own client, logged in: its first-visit `?token=` handoff takes the token
 * this client already holds (every instance shares one), stores it and strips it from the url.
 */
export function peerHref(peer: Pick<PeerSnapshot, "url">, path: string, token: string): string {
  return `${peer.url}${path}?token=${encodeURIComponent(token)}`;
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

/** Whether a session on another instance is asking for input and not hidden there. */
export function waitingPeers(peers: PeerSnapshot[]): boolean {
  return peers.some((p) => p.sessions.some((s) => s.state === "needs-input" && !s.hidden));
}

/** `peers.updated` applied to the cached answer: the peer replaced in place, by name. */
export function replacePeer(answer: PeersAnswer | undefined, peer: PeerSnapshot): PeersAnswer | undefined {
  if (!answer || !answer.peers.some((p) => p.name === peer.name)) return answer;
  return { ...answer, peers: answer.peers.map((p) => (p.name === peer.name ? peer : p)) };
}
