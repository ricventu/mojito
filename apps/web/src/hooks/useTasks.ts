import { useQuery } from "@tanstack/react-query";
import type { TaskRecord } from "@mojito/shared";
import { apiFetch } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

export function useTasks() {
  return useQuery({ queryKey: qk.tasks, queryFn: () => apiFetch<TaskRecord[]>("/api/tasks") });
}
