import { useQuery } from "@tanstack/react-query";
import type { DocFile, DocList } from "@mojito/shared";
import { apiFetch } from "@/lib/api";
import { hostApi } from "@/lib/host";
import { docKeys } from "@/lib/queryKeys";

/** `host` is a peer's name (null: this instance); a peer's calls go through the relay. */
const base = (host: string | null, project: string) =>
  hostApi(host, `/api/projects/${encodeURIComponent(project)}/docs`);

// Both reads are snapshots: never refetched behind the reader's back, and dropped once the page
// unmounts (`gcTime: 0`), so each entry to the page reads afresh. Reload resets them.
const snapshot = { staleTime: Infinity, gcTime: 0, refetchOnWindowFocus: false } as const;

/** A project's documents, with the ticket's own listed apart; not read while `enabled` is false. */
export function useDocList(host: string | null, project: string, ticket: string | null, enabled = true) {
  return useQuery({
    queryKey: docKeys.list(host, project, ticket),
    queryFn: () => apiFetch<DocList>(`${base(host, project)}${ticket ? `?ticket=${encodeURIComponent(ticket)}` : ""}`),
    enabled,
    ...snapshot,
  });
}

/** One document, when `path` is set. */
export function useDocFile(host: string | null, project: string, ticket: string | null, path: string | null) {
  return useQuery({
    queryKey: docKeys.file(host, project, ticket, path ?? ""),
    queryFn: () => {
      const params = new URLSearchParams({ path: path! });
      if (ticket) params.set("ticket", ticket);
      return apiFetch<DocFile>(`${base(host, project)}/file?${params}`);
    },
    enabled: path !== null,
    ...snapshot,
  });
}
