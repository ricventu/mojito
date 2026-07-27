"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "./client";

// Mirrors DocEntry in src/server/docFiles.ts. Declared again rather than imported:
// that module reaches for node:fs and node:child_process at load time and has no
// business anywhere near the browser bundle.
export interface DocEntry {
  path: string;
  name: string;
  source: "specs" | "plans" | "branch";
  mtime: string;
  size: number;
}

// A docs request is scoped either to a live session (its cwd is the worktree) or
// to a ticket (the server resolves the worktree the way a launch would).
export type DocsTarget = { session: string } | { ticket: string; project: string | null };

export function targetQuery(t: DocsTarget): string {
  const p = new URLSearchParams();
  if ("session" in t) p.set("session", t.session);
  else {
    p.set("ticket", t.ticket);
    if (t.project) p.set("project", t.project);
  }
  return p.toString();
}

// The routes answer with lowercase API strings ("no worktree for this ticket");
// these are the sentences the user reads. Mapping by status keeps the two apart,
// so an API wording change cannot rewrite the UI copy by accident.
export function listErrorMessage(status: number): string {
  if (status === 409) return "No worktree for this ticket.";
  if (status === 404) return "This session is gone.";
  if (status === 400) return "This session has no working directory.";
  return "Could not load documents.";
}

export function docErrorMessage(status: number): string {
  if (status === 404) return "Document not found.";
  if (status === 413) return "Document too large to display.";
  if (status === 400) return "Invalid document path.";
  return "Could not load the document.";
}

// `reload` is a counter the caller bumps to re-fetch the list — mirrors
// useDocContent's parameter below, so a session writing a new spec can be
// picked up without closing and reopening the overlay.
export function useDocList(token: string, target: DocsTarget, reload: number) {
  const [files, setFiles] = useState<DocEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Depend on the serialised query, not the target object: a fresh object
  // literal on every render would re-fetch forever.
  const q = targetQuery(target);
  useEffect(() => {
    let alive = true;
    setFiles(null);
    setError(null);
    apiFetch(token, `/api/docs?${q}`)
      .then(async (res) => {
        if (!alive) return;
        if (!res.ok) setError(listErrorMessage(res.status));
        else setFiles(((await res.json()).files ?? []) as DocEntry[]);
      })
      .catch(() => { if (alive) setError("Could not load documents."); });
    return () => { alive = false; };
  }, [token, q, reload]);
  return { files, error };
}

// `reload` is a counter the caller bumps to re-fetch the same path — a spec can be
// rewritten by the session while it is on screen.
export function useDocContent(token: string, target: DocsTarget, path: string | null, reload: number) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = targetQuery(target);
  useEffect(() => {
    if (!path) { setContent(null); setError(null); return; }
    let alive = true;
    setContent(null);
    setError(null);
    apiFetch(token, `/api/docs/content?${q}&path=${encodeURIComponent(path)}`)
      .then(async (res) => {
        if (!alive) return;
        if (!res.ok) setError(docErrorMessage(res.status));
        else setContent((await res.json()).content as string);
      })
      .catch(() => { if (alive) setError("Could not load the document."); });
    return () => { alive = false; };
  }, [token, q, path, reload]);
  return { content, error };
}
