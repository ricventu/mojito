import { useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { TicketSummary } from "@mojito/shared";
import { apiJson } from "@/lib/api";
import { DONE_STATUS } from "@/lib/board";
import { DeferredActions } from "@/lib/deferred";
import { qk } from "@/lib/queryKeys";

/** How long the Undo toast stays, and how long Linear waits for it. */
export const UNDO_MS = 3000;

// One for the app, not per board: leaving the board must neither drop nor run a pending Done.
const quickDone = new DeferredActions();

/** The tickets a quick Done has taken off the board: waiting out the Undo, or being written. */
export function useQuickDoneHidden(): ReadonlySet<string> {
  return useSyncExternalStore(quickDone.subscribe, quickDone.snapshot);
}

/**
 * A card's Done: the ticket leaves the board at once, a toast offers Undo, and only once that has
 * run out is Linear written. It stays hidden until the board's refetch no longer lists it (the
 * server refreshes its cache before answering); a refusal brings it back with an error toast.
 */
export function useQuickDone(): (ticket: TicketSummary) => void {
  const qc = useQueryClient();
  return (ticket) => {
    const id = ticket.identifier;
    const scheduled = quickDone.schedule(
      id,
      async () => {
        try {
          await apiJson<unknown>(`/api/tickets/${encodeURIComponent(id)}/status`, "POST", { status: DONE_STATUS });
          await qc.invalidateQueries({ queryKey: qk.tickets });
        } catch (e) {
          toast.error(`${id}: ${e instanceof Error ? e.message : "Status change failed"}`);
          throw e;
        }
      },
      UNDO_MS,
    );
    if (!scheduled) return;
    toast(`${id} → ${DONE_STATUS}`, {
      id: `quick-done-${id}`,
      duration: UNDO_MS,
      action: { label: "Undo", onClick: () => quickDone.undo(id) },
    });
  };
}
