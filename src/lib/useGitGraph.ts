"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "./client";
import type { CommitDetails, GraphPage } from "./gitGraph";

// What a graph is of: a project's repo, a ticket (its worktree, else its repo), or a
// live session's cwd. The standalone view only ever holds the first two — a session's
// graph is an overlay inside its terminal (see appLocation).
export type GitTarget = { project: string } | { ticket: string; project: string | null } | { session: string };

export function gitTargetQuery(t: GitTarget): string {
  const p = new URLSearchParams();
  if ("session" in t) p.set("session", t.session);
  else if ("ticket" in t) {
    p.set("ticket", t.ticket);
    if (t.project) p.set("project", t.project);
  } else p.set("project", t.project);
  return p.toString();
}

// Status → the sentence the user reads, kept apart from the API's lowercase strings so
// an API wording change cannot rewrite the UI copy (as useDocs does). A 409 is git
// itself talking, and its words are the useful part.
export function graphErrorMessage(status: number, target: GitTarget, detail?: string): string {
  if (status === 404) {
    if ("session" in target) return "This session no longer exists.";
    if ("ticket" in target) return "This ticket maps to no repo.";
    return "Unknown project.";
  }
  if (status === 409 && detail) return detail;
  if (status === 400) return "This session has no working directory.";
  return "Could not load the git graph.";
}

export function commitErrorMessage(status: number): string {
  return status === 404 ? "Commit not found." : "Could not load the commit.";
}

export function appendPage(prev: GraphPage, next: GraphPage): GraphPage {
  const have = new Set(prev.commits.map((c) => c.hash));
  return { ...prev, commits: [...prev.commits, ...next.commits.filter((c) => !have.has(c.hash))], hasMore: next.hasMore };
}

async function errorDetail(res: Response): Promise<string | undefined> {
  try { return ((await res.json()) as { error?: string }).error; } catch { return undefined; }
}

// `reload` is a counter the caller bumps — the graph is a snapshot, refreshed by hand.
export function useGitGraph(token: string, target: GitTarget, reload: number) {
  const [page, setPage] = useState<GraphPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  // Bumped by every initial load. A load-more response that lands after a bump belongs
  // to the graph that was on screen before it, so it is dropped rather than appended.
  const generation = useRef(0);
  // The serialised query, not the object: a fresh literal each render would re-fetch forever.
  const q = gitTargetQuery(target);

  useEffect(() => {
    let alive = true;
    generation.current += 1;
    setPage(null);
    setError(null);
    setMoreError(false);
    setLoadingMore(false);
    apiFetch(token, `/api/git/graph?${q}`)
      .then(async (res) => {
        if (!alive) return;
        if (!res.ok) setError(graphErrorMessage(res.status, target, await errorDetail(res)));
        else setPage((await res.json()) as GraphPage);
      })
      .catch(() => { if (alive) setError("Could not load the git graph."); });
    return () => { alive = false; };
    // `target` is represented by `q`.
  }, [token, q, reload]);

  const loadMore = useCallback(() => {
    if (!page || !page.hasMore || loadingMore) return;
    const gen = generation.current;
    setLoadingMore(true);
    setMoreError(false);
    apiFetch(token, `/api/git/graph?${q}&skip=${page.commits.length}`)
      .then(async (res) => {
        if (gen !== generation.current) return;
        if (!res.ok) { setMoreError(true); return; }
        const next = (await res.json()) as GraphPage;
        if (gen !== generation.current) return;
        setPage((prev) => (prev ? appendPage(prev, next) : prev));
      })
      .catch(() => { if (gen === generation.current) setMoreError(true); })
      .finally(() => { if (gen === generation.current) setLoadingMore(false); });
  }, [token, q, page, loadingMore]);

  return { page, error, loadMore, loadingMore, moreError };
}

export function useGitCommit(token: string, target: GitTarget, hash: string | null) {
  const [details, setDetails] = useState<CommitDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = gitTargetQuery(target);
  useEffect(() => {
    setDetails(null);
    setError(null);
    if (!hash) return;
    let alive = true;
    apiFetch(token, `/api/git/commit?${q}&hash=${encodeURIComponent(hash)}`)
      .then(async (res) => {
        if (!alive) return;
        if (!res.ok) setError(commitErrorMessage(res.status));
        else setDetails((await res.json()) as CommitDetails);
      })
      .catch(() => { if (alive) setError("Could not load the commit."); });
    return () => { alive = false; };
  }, [token, q, hash]);
  return { details, error };
}
