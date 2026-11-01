import type { PeerSnapshot } from "@mojito/shared";
import { peerHref } from "@/lib/peers";
import { sessionCount, sessionLabel, sidebarGroups } from "@/lib/sidebar";
import { GroupList, HostSection } from "./HostSection";
import { SidebarRow } from "./SidebarRow";

/**
 * Another instance in the sidebar: its band, then its sessions grouped by its projects. Each
 * row opens that instance's own client at the session, in a new tab; the band's ↗ opens its
 * client. An offline instance is its band alone.
 */
export function PeerSection({ peer, token }: { peer: PeerSnapshot; token: string }) {
  const groups = sidebarGroups(peer.projects.map((name) => ({ name })), peer.sessions);
  const tickets = Object.entries(peer.ticketTitles).map(([identifier, title]) => ({ identifier, title }));

  return (
    <HostSection name={peer.name} count={sessionCount(groups)} online={peer.online} href={peerHref(peer, "/", token)}>
      {peer.online && (
        <GroupList
          nested
          groups={groups}
          row={(s) => (
            <SidebarRow
              key={s.id}
              session={s}
              label={sessionLabel(s, tickets)}
              current={false}
              replace={false}
              onPick={() => {}}
              remote={{ host: peer.name, href: peerHref(peer, `/session/${encodeURIComponent(s.id)}`, token) }}
            />
          )}
        />
      )}
    </HostSection>
  );
}
