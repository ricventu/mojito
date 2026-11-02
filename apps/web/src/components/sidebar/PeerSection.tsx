import type { PeerSnapshot } from "@mojito/shared";
import { sessionHref } from "@/lib/host";
import { peerHref } from "@/lib/peers";
import { isCurrent, sessionCount, sessionLabel, sidebarGroups, type CurrentSession } from "@/lib/sidebar";
import { GroupList, HostSection } from "./HostSection";
import { SidebarRow } from "./SidebarRow";

interface Props {
  peer: PeerSnapshot;
  token: string;
  current?: CurrentSession;
  /** As for this instance's rows: replace the history entry when picked from a terminal. */
  replace: boolean;
  onPick(): void;
}

/**
 * Another instance in the sidebar: its band, then its sessions grouped by its projects. Each
 * row opens the session in this client's terminal, as a local row does; the band's ↗ opens
 * the instance's own client in this tab. An offline instance is its band alone.
 */
export function PeerSection({ peer, token, current, replace, onPick }: Props) {
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
              to={sessionHref(peer.name, s.id)}
              label={sessionLabel(s, tickets)}
              current={isCurrent(current, peer.name, s.id)}
              replace={replace}
              onPick={onPick}
            />
          )}
        />
      )}
    </HostSection>
  );
}
