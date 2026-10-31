import type { PeersAnswer } from "@mojito/shared";
import type { PeerConfig } from "../config";
import type { PeerLink } from "./link";

/** The configured peers' links, by name: what the routes and the boot see. */
export class PeerRegistry {
  readonly self: string;
  private readonly links: PeerLink[];

  constructor(self: string, links: PeerLink[]) {
    this.self = self;
    this.links = links;
  }

  /** `GET /api/peers`: the peers in configuration order. */
  answer(): PeersAnswer {
    return { self: this.self, peers: this.links.map((l) => l.snapshot()) };
  }

  config(name: string): PeerConfig | undefined {
    return this.link(name)?.peer;
  }

  online(name: string): boolean {
    return this.link(name)?.snapshot().online ?? false;
  }

  start(): void {
    for (const l of this.links) l.start();
  }

  stop(): void {
    for (const l of this.links) l.stop();
  }

  private link(name: string): PeerLink | undefined {
    return this.links.find((l) => l.peer.name === name);
  }
}
