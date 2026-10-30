import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { EyeOff, Pin, PinOff, X } from "lucide-react";
import { toast } from "sonner";
import type { SessionMeta } from "@mojito/shared";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useProjects } from "@/hooks/useProjects";
import { useSessions } from "@/hooks/useSessions";
import type { SidebarState } from "@/hooks/useSidebar";
import { useTickets } from "@/hooks/useTickets";
import { apiJson } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { sessionLabel, sidebarGroups, splitHidden, type SidebarGroup } from "@/lib/sidebar";
import { cn } from "@/lib/utils";
import { SidebarRow } from "./SidebarRow";

interface Props {
  sidebar: SidebarState;
  /** The session whose terminal is on screen, highlighted. */
  currentId?: string;
  /** Replace the history entry when a row is picked: from a terminal, Back keeps meaning the board. */
  replace?: boolean;
  /** Placement of the docked column, which is the page's to decide (fixed on the board, a flex child on the terminal). */
  dockedClassName?: string;
}

/** The header, the grouped list and the hidden footer: the same in the docked column and the overlay. */
function Panel({ sidebar, currentId, replace, inSheet }: Omit<Props, "dockedClassName"> & { inSheet: boolean }) {
  const sessions = useSessions();
  const tickets = useTickets();
  const projects = useProjects();
  const qc = useQueryClient();
  const [showHidden, setShowHidden] = useState(false);
  const hiddenRef = useRef<HTMLDivElement>(null);

  const { shown, hidden } = useMemo(
    () => splitHidden(sidebarGroups(projects.data ?? [], sessions.data ?? [])),
    [projects.data, sessions.data],
  );
  const ticketList = tickets.data?.tickets ?? [];
  const hiddenSessions = hidden.flatMap((g) => g.sessions);
  const hiddenWaiting = hiddenSessions.some((s) => s.state === "needs-input");
  const expanded = showHidden && hiddenSessions.length > 0;

  useEffect(() => {
    if (expanded) hiddenRef.current?.scrollIntoView({ block: "nearest" });
  }, [expanded]);

  // The row's link navigates; a pick only closes the overlay.
  const pick = () => {
    if (!sidebar.docked) sidebar.close();
  };

  // Optimistic: the row moves at once; the server's `session.updated` confirms it. A refetch
  // already in flight is cancelled first, or its older list would put the row back. A failure
  // re-reads the list rather than remembering what to roll back.
  const setHidden = async (id: string, next: boolean) => {
    await qc.cancelQueries({ queryKey: qk.sessions });
    qc.setQueryData<SessionMeta[]>(qk.sessions, (list) => list?.map((s) => (s.id === id ? { ...s, hidden: next } : s)));
    try {
      await apiJson<SessionMeta>(`/api/sessions/${encodeURIComponent(id)}`, "PATCH", { hidden: next });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : next ? "Hiding failed" : "Showing failed");
      void qc.invalidateQueries({ queryKey: qk.sessions });
    }
  };

  const groupList = (groups: SidebarGroup[]) =>
    groups.map((g) => (
      <section key={g.project ?? "general"} className="flex flex-col gap-0.5">
        <h3 className="truncate px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">{g.project ?? "General"}</h3>
        <ul className="flex flex-col gap-0.5">
          {g.sessions.map((s) => (
            <SidebarRow
              key={s.id}
              session={s}
              label={sessionLabel(s, ticketList)}
              current={s.id === currentId}
              replace={replace ?? false}
              onPick={pick}
              onHide={(next) => void setHidden(s.id, next)}
            />
          ))}
        </ul>
      </section>
    ));

  return (
    <>
      <div className="flex items-center gap-1 border-b py-2 pr-2 pl-4">
        {inSheet ? (
          <SheetTitle className="min-w-0 flex-1 truncate text-base">Sessions</SheetTitle>
        ) : (
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold">Sessions</h2>
        )}
        {inSheet && <SheetDescription className="sr-only">The live sessions, grouped by project.</SheetDescription>}
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
        {shown.length === 0 && hiddenSessions.length === 0 && (
          <p className="px-2 py-3 text-sm text-muted-foreground">No live sessions</p>
        )}
        {groupList(shown)}
        {expanded && (
          <div ref={hiddenRef} className="mt-2 border-t pt-1">
            {groupList(hidden)}
          </div>
        )}
      </nav>
      {hiddenSessions.length > 0 && (
        <div className="border-t p-2">
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={expanded}
            className={cn(
              "w-full justify-start",
              hiddenWaiting ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground",
            )}
            onClick={() => setShowHidden(!showHidden)}
          >
            <EyeOff size={14} /> Hidden ({hiddenSessions.length})
          </Button>
        </div>
      )}
    </>
  );
}

/**
 * The live sessions, wherever the user is. Docked, it is a column the page places
 * (`dockedClassName`); otherwise an overlay from the left, so the pty is never resized for a
 * peek. Both pay the insets of the edges they touch: the overlay here, the docked column
 * through its page's class.
 */
export function SessionSidebar({ sidebar, currentId, replace = false, dockedClassName }: Props) {
  if (sidebar.docked) {
    return (
      // `data-sidebar-docked` sets `--dock-width` (index.css), which must stay equal to `w-72`.
      <aside data-sidebar-docked className={cn("flex w-72 shrink-0 flex-col border-r bg-background", dockedClassName)}>
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
