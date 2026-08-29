import { BACKLOG_STATUS } from "@/lib/status";
import type { ListFilters } from "@/lib/appLocation";

/**
 * What the Backlog chip is showing (RIC-275). Three states where every other status
 * chip has two, because the Backlog is the one bucket the board hides by default:
 *
 * - `off`   — hidden. The default, and what the board opens on.
 * - `only`  — the ordinary single-select: this status and nothing else.
 * - `on`    — shown alongside every other status.
 */
export type BacklogChip = "off" | "only" | "on";

/**
 * The chip's state, read off the two filter values that between them express it.
 *
 * An explicit selection wins over the flag: the "only" state is reached with the flag
 * still off, and a hand-typed url carrying both has asked for Backlog outright.
 *
 * While *another* status is selected the exclusion is moot — that filter already drops
 * every Backlog ticket — but the chip still reports `off`, because this row is the only
 * place the setting is visible and it is what the board reverts to on "All".
 */
export function backlogChip({ status, backlog }: ListFilters): BacklogChip {
  if (status === BACKLOG_STATUS) return "only";
  return backlog ? "on" : "off";
}

/**
 * The filters after one tap of the Backlog chip: `off → only → on → off`.
 *
 * Each step moves only the value that step owns. Selecting Backlog leaves the flag
 * alone (filterTickets lets the selection win), and un-hiding drops the selection the
 * way tapping any status chip does — but the last step, back to `off`, leaves `status`
 * where it is: reaching `off` from a board filtered to Todo must not also clear Todo,
 * which the user chose two chips away and this one does not own.
 */
export function cycleBacklog(filters: ListFilters): ListFilters {
  switch (backlogChip(filters)) {
    case "off": return { ...filters, status: BACKLOG_STATUS };
    case "only": return { ...filters, status: null, backlog: true };
    case "on": return { ...filters, backlog: false };
  }
}
