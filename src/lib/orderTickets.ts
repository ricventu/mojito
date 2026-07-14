import type { TicketSummary } from "@/server/types";

/**
 * Order tickets newest-first by identifier, numeric-aware so RIC-114 precedes RIC-9.
 * Returns a new array; does not mutate the input.
 */
export function orderTickets(tickets: TicketSummary[]): TicketSummary[] {
  return [...tickets].sort((a, b) =>
    b.identifier.localeCompare(a.identifier, undefined, { numeric: true }),
  );
}
