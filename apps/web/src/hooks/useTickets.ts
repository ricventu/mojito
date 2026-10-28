import { useQuery } from "@tanstack/react-query";
import type { BoardTickets } from "@mojito/shared";
import { apiFetch } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

export function useTickets() {
  return useQuery({ queryKey: qk.tickets, queryFn: () => apiFetch<BoardTickets>("/api/tickets") });
}
