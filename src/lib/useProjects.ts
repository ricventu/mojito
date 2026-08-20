"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "./client";

/**
 * The configured projects — projects.json's names, as /api/projects reports them.
 *
 * Two callers, for the same reason: the project field in the sheets offers what the
 * server can actually launch into, and since RIC-225 the board's project filter offers
 * the same set instead of only the projects its open tickets happen to name.
 *
 * An empty array is "not loaded yet" as much as "none configured" — the fetch answers a
 * render or two after mount — which is what knownProject's own empty-list rule is
 * written against, and why mergedProjects merges rather than replaces.
 */
export function useProjects(token: string): string[] {
  const [projects, setProjects] = useState<string[]>([]);

  useEffect(() => {
    apiFetch(token, "/api/projects")
      .then((r) => (r.ok ? r.json() : { projects: [] }))
      .then((d: { projects: string[] }) => setProjects(d.projects))
      .catch(() => setProjects([]));
  }, [token]);

  return projects;
}
