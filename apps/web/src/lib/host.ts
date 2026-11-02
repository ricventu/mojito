// Which Mojito instance a page talks to. `?host=<name>` addresses a peer's session, git graph or
// docs in place: calls go through this instance's relay (`/api/peers/<name>/…`,
// `/ws/peers/<name>/pty/<id>`). No `host` means this instance. A name is never read as this
// instance unless it equals `self`, and an unknown one is not found — never a silent fallback.

import type { PeerSnapshot, PeersAnswer } from "@mojito/shared";

export type HostResolution =
  | { kind: "self" }
  | { kind: "peer"; peer: PeerSnapshot }
  | { kind: "unknown"; name: string }
  | { kind: "loading" };

/** No param is this instance at once (the peers answer is not waited for); a name needs it. */
export function resolveHost(param: string | null, answer: PeersAnswer | undefined): HostResolution {
  if (!param) return { kind: "self" };
  if (!answer) return { kind: "loading" };
  if (param === answer.self) return { kind: "self" };
  const peer = answer.peers.find((p) => p.name === param);
  return peer ? { kind: "peer", peer } : { kind: "unknown", name: param };
}

/** `path` starts with `/api/`; a peer's goes through the relay, which strips the prefix. */
export function hostApi(host: string | null, path: string): string {
  return host === null ? path : `/api/peers/${encodeURIComponent(host)}/${path.slice("/api/".length)}`;
}

export function ptyPath(host: string | null, id: string): string {
  return host === null
    ? `/ws/pty/${encodeURIComponent(id)}`
    : `/ws/peers/${encodeURIComponent(host)}/pty/${encodeURIComponent(id)}`;
}

export function sessionHref(host: string | null, id: string): string {
  return `/session/${encodeURIComponent(id)}${host === null ? "" : `?host=${encodeURIComponent(host)}`}`;
}

/** The peer's name to put on a call or a key; null for this instance and for anything unresolved. */
export function hostOf(r: HostResolution): string | null {
  return r.kind === "peer" ? r.peer.name : null;
}
