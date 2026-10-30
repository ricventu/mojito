import { useQuery } from "@tanstack/react-query";
import type { DocFile, DocList } from "@mojito/shared";
import { apiFetch } from "@/lib/api";
import { docKeys } from "@/lib/queryKeys";

const base = (project: string) => `/api/projects/${encodeURIComponent(project)}/docs`;

// Both reads are snapshots: never refetched behind the reader's back, and dropped once the page
// unmounts (`gcTime: 0`), so each entry to the page reads afresh. Reload resets them.
const snapshot = { staleTime: Infinity, gcTime: 0, refetchOnWindowFocus: false } as const;

/** A project's documents, with the ticket's own listed apart; not read while `enabled` is false. */
export function useDocList(project: string, ticket: string | null, enabled = true) {
  return useQuery({
    queryKey: docKeys.list(project, ticket),
    queryFn: () => apiFetch<DocList>(`${base(project)}${ticket ? `?ticket=${encodeURIComponent(ticket)}` : ""}`),
    enabled,
    ...snapshot,
  });
}

/** One document, when `path` is set. */
export function useDocFile(project: string, ticket: string | null, path: string | null) {
  return useQuery({
    queryKey: docKeys.file(project, ticket, path ?? ""),
    queryFn: () => {
      const params = new URLSearchParams({ path: path! });
      if (ticket) params.set("ticket", ticket);
      return apiFetch<DocFile>(`${base(project)}/file?${params}`);
    },
    enabled: path !== null,
    ...snapshot,
  });
}
