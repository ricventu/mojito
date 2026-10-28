import { useQuery } from "@tanstack/react-query";
import type { ProjectRow } from "@mojito/shared";
import { apiFetch } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

export function useProjects() {
  return useQuery({ queryKey: qk.projects, queryFn: () => apiFetch<ProjectRow[]>("/api/projects") });
}
