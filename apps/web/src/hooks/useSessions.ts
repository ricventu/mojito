import { useQuery } from "@tanstack/react-query";
import type { SessionMeta } from "@mojito/shared";
import { apiFetch } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

export function useSessions() {
  return useQuery({ queryKey: qk.sessions, queryFn: () => apiFetch<SessionMeta[]>("/api/sessions") });
}
