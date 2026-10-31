import { useSyncExternalStore } from "react";
import type { PeerSnapshot } from "@mojito/shared";
import { peerHref } from "@/lib/peers";
import { sessionLabel, sidebarGroups, splitHidden } from "@/lib/sidebar";
import { getToken, subscribeToken } from "@/lib/token";
import { cn } from "@/lib/utils";
import { SidebarRow } from "./SidebarRow";

/** The dot every peer entry carries: online green, offline grey. */
export function PeerDot({ online }: { online: boolean }) {
  return <span aria-hidden className={cn("size-2 shrink-0 rounded-full", online ? "bg-emerald-500" : "bg-muted-foreground/40")} />;
}

/** A peer's sessions split like the local ones: the shown half and the Hidden footer's half. */
export function peerHalves(peer: PeerSnapshot) {
  return splitHidden(sidebarGroups(peer.projects.map((name) => ({ name })), peer.sessions));
}

/**
 * Another instance in the sidebar: its name and dot, then its sessions grouped by its projects.
 * Each row opens that instance's own client at the session, in a new tab. `hidden` draws the
 * half that instance has hidden (for the Hidden footer); an offline peer is its heading alone,
 * in the shown half only.
 */
export function PeerSection({ peer, hidden }: { peer: PeerSnapshot; hidden: boolean }) {
  const token = useSyncExternalStore(subscribeToken, getToken);
  const groups = peerHalves(peer)[hidden ? "hidden" : "shown"];
  if (hidden && groups.length === 0) return null;
  const tickets = Object.entries(peer.ticketTitles).map(([identifier, title]) => ({ identifier, title }));

  return (
    <section aria-label={`Sessions on ${peer.name}`} className="mt-2 flex flex-col gap-0.5 border-t pt-2">
      <h3 className="flex items-center gap-2 px-2 pb-1 text-xs font-semibold">
        <PeerDot online={peer.online} />
        <span className="truncate">{peer.name}</span>
        {!peer.online && <span className="font-normal text-muted-foreground">offline</span>}
      </h3>
      {groups.map((g) => (
        <section key={g.project ?? "general"} className="flex flex-col gap-0.5">
          <h4 className="truncate px-2 pt-1 pb-1 text-xs font-medium text-muted-foreground">{g.project ?? "General"}</h4>
          <ul className="flex flex-col gap-0.5">
            {g.sessions.map((s) => (
              <SidebarRow
                key={s.id}
                session={s}
                label={sessionLabel(s, tickets)}
                current={false}
                replace={false}
                onPick={() => {}}
                href={peerHref(peer, `/session/${encodeURIComponent(s.id)}`, token)}
              />
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
