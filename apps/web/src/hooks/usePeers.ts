import { useQuery } from "@tanstack/react-query";
import type { PeersAnswer } from "@mojito/shared";
import { apiFetch } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

/** This instance's name and the other instances' snapshots; `peers.updated` keeps it live. */
export function usePeers() {
  return useQuery({ queryKey: qk.peers, queryFn: () => apiFetch<PeersAnswer>("/api/peers") });
}
