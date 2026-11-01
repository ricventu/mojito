import { useMemo, useSyncExternalStore } from "react";
import { Pin, PinOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { usePeers } from "@/hooks/usePeers";
import { useProjects } from "@/hooks/useProjects";
import { useSessions } from "@/hooks/useSessions";
import type { SidebarState } from "@/hooks/useSidebar";
import { useTickets } from "@/hooks/useTickets";
import { sessionCount, sessionLabel, sidebarGroups } from "@/lib/sidebar";
import { getToken, subscribeToken } from "@/lib/token";
import { GroupList, HostSection } from "./HostSection";
import { PeerSection } from "./PeerSection";
import { SidebarRow } from "./SidebarRow";

interface Props {
  sidebar: SidebarState;
  /** The session whose terminal is on screen, highlighted. */
  currentId?: string;
  /** Replace the history entry when a row is picked: from a terminal, Back keeps meaning the board. */
  replace?: boolean;
}

/**
 * The header and the grouped list: the same in the docked column and the overlay. With peers
 * configured every instance gets a band (`HostSection`), this one first; without, the list is
 * this instance's projects alone, as before peers existed.
 */
function Panel({ sidebar, currentId, replace, inSheet }: Props & { inSheet: boolean }) {
  const sessions = useSessions();
  const tickets = useTickets();
  const projects = useProjects();
  const peers = usePeers();
  const token = useSyncExternalStore(subscribeToken, getToken);

  const groups = useMemo(() => sidebarGroups(projects.data ?? [], sessions.data ?? []), [projects.data, sessions.data]);
  const ticketList = tickets.data?.tickets ?? [];
  const answer = peers.data && peers.data.peers.length > 0 ? peers.data : null;

  // The row's link navigates; a pick only closes the overlay.
  const pick = () => {
    if (!sidebar.docked) sidebar.close();
  };

  const local = (
    <GroupList
      nested={answer !== null}
      groups={groups}
      row={(s) => (
        <SidebarRow
          key={s.id}
          session={s}
          label={sessionLabel(s, ticketList)}
          current={s.id === currentId}
          replace={replace ?? false}
          onPick={pick}
        />
      )}
    />
  );

  return (
    <>
      <div className="flex items-center gap-1 border-b py-2 pr-2 pl-4">
        {inSheet ? (
          <SheetTitle className="min-w-0 flex-1 truncate text-base">Sessions</SheetTitle>
        ) : (
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold">Sessions</h2>
        )}
        {inSheet && <SheetDescription className="sr-only">The live sessions, grouped by host and project.</SheetDescription>}
        {sidebar.canPin && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={sidebar.pinned ? "Unpin" : "Pin"}
            aria-pressed={sidebar.pinned}
            onClick={() => sidebar.setPinned(!sidebar.pinned)}
          >
            {sidebar.pinned ? <PinOff size={16} /> : <Pin size={16} />}
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={sidebar.close}>
          <X size={16} />
        </Button>
      </div>
      <nav aria-label="Live sessions" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {answer ? (
          <>
            <HostSection name={answer.self} count={sessionCount(groups)} online first>
              {local}
            </HostSection>
            {answer.peers.map((p) => (
              <PeerSection key={p.name} peer={p} token={token} />
            ))}
          </>
        ) : (
          local
        )}
      </nav>
    </>
  );
}

/**
 * The live sessions, wherever the user is (AppShell draws it once for every page). Docked, it
 * is a fixed column on the left, which the pages start after; otherwise an overlay from the
 * left, so the pty is never resized for a peek. Both pay the insets of the edges they touch.
 */
export function SessionSidebar({ sidebar, currentId, replace = false }: Props) {
  if (sidebar.docked) {
    return (
      // `data-sidebar-docked` sets `--dock-width` (index.css), which must stay equal to `w-72`.
      <aside
        data-sidebar-docked
        className="fixed inset-y-0 left-0 z-20 flex w-72 flex-col border-r bg-background pt-[var(--sat)] pb-[var(--sab)] pl-[var(--sal)]"
      >
        <Panel sidebar={sidebar} currentId={currentId} replace={replace} inSheet={false} />
      </aside>
    );
  }
  return (
    <Sheet open={sidebar.open} onOpenChange={(o) => !o && sidebar.close()}>
      <SheetContent
        side="left"
        showCloseButton={false}
        className="w-72 gap-0 pt-[var(--sat)] pb-[var(--sab)] pl-[var(--sal)]"
      >
        <Panel sidebar={sidebar} currentId={currentId} replace={replace} inSheet />
      </SheetContent>
    </Sheet>
  );
}
