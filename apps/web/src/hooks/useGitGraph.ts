import { useCallback } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import type { CommitDetails, CommitDiff, GitGraphPage } from "@mojito/shared";
import { apiFetch } from "@/lib/api";
import { gitKeys } from "@/lib/queryKeys";

const base = (project: string) => `/api/projects/${encodeURIComponent(project)}/git`;

/**
 * A project's graph, one page of commits at a time; the next page skips what is loaded. A snapshot:
 * never refetched behind the reader's back. A reload or another ticket is another query, so a late
 * page of the old one cannot land in the new one. `gcTime: 0` drops it once nothing reads it, so
 * each entry to the page is a fresh read rather than the pages cached on the last visit.
 */
export function useGitGraph(project: string, ticket: string | null) {
  return useInfiniteQuery({
    queryKey: gitKeys.graph(project, ticket),
    queryFn: ({ pageParam }) =>
      apiFetch<GitGraphPage>(
        `${base(project)}/graph?skip=${pageParam}${ticket ? `&ticket=${encodeURIComponent(ticket)}` : ""}`,
      ),
    initialPageParam: 0,
    // Raw page lengths, not the deduplicated rows (`pageCommits`): that is what `--skip` counts.
    getNextPageParam: (last, pages) =>
      last.hasMore ? pages.reduce((n, p) => n + p.commits.length, 0) : undefined,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
}

/** One commit's details; a commit never changes. */
export function useCommit(project: string, hash: string | null) {
  return useQuery({
    queryKey: gitKeys.commit(project, hash ?? ""),
    queryFn: () => apiFetch<CommitDetails>(`${base(project)}/commits/${encodeURIComponent(hash!)}`),
    enabled: hash !== null,
    staleTime: Infinity,
  });
}

/** One file's diff in a commit; `from` keeps a rename a rename. */
export function useDiff(project: string, hash: string | null, file: string | null, from: string | null) {
  return useQuery({
    queryKey: gitKeys.diff(project, hash ?? "", file ?? "", from),
    queryFn: () => {
      const params = new URLSearchParams({ path: file! });
      if (from) params.set("from", from);
      return apiFetch<CommitDiff>(`${base(project)}/commits/${encodeURIComponent(hash!)}/diff?${params}`);
    },
    enabled: hash !== null && file !== null,
    staleTime: Infinity,
  });
}

/**
 * react-router's index of the current history entry: 0 for the entry the tab was opened on, kept
 * across replaces (which give an entry a fresh `location.key`, so the key cannot tell the first one).
 */
export function historyIndex(): number {
  const idx = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof idx === "number" ? idx : 0;
}

/**
 * Back that stays in the app: history back when there is an entry of ours to go back to, else
 * (a link opened in a fresh tab) `fallback`, replacing the current entry.
 */
export function useBackOr(): (fallback: string) => void {
  const navigate = useNavigate();
  return useCallback(
    (fallback: string) => {
      if (historyIndex() > 0) void navigate(-1);
      else void navigate(fallback, { replace: true });
    },
    [navigate],
  );
}
