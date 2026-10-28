import { useQuery } from "@tanstack/react-query";
import type { Settings } from "@mojito/shared";
import { apiFetch } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

export function useSettings() {
  return useQuery({ queryKey: qk.settings, queryFn: () => apiFetch<Settings>("/api/settings") });
}
