"use client";
import { ChevronLeft, FolderGit2, RotateCw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { highlightChain, highlightSummary, layoutGraph, type GraphCommit, type GraphRow } from "@/lib/gitGraph";
import { useGitCommit, useGitGraph, type GitTarget } from "@/lib/useGitGraph";
import { relativeTime } from "@/lib/relativeTime";

const LANE_W = 12;
const NARROW = "(max-width: 479px)";

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia(NARROW).matches);
  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

function seg(x1: number, y1: number, x2: number, y2: number): string {
  if (x1 === x2) return `M${x1} ${y1}V${y2}`;
  const my = (y1 + y2) / 2;
  return `M${x1} ${y1}C${x1} ${my} ${x2} ${my} ${x2} ${y2}`;
}

function Lanes({ row, cols, h, hl }: { row: GraphRow; cols: number; h: number; hl: boolean }) {
  const x = (i: number) => i * LANE_W + LANE_W / 2;
  const mid = h / 2;
  const stroke = (c: number) => `var(--graph-${c})`;
  return (
    <svg width={cols * LANE_W} height={h} aria-hidden="true">
      {row.top.map((s, k) => <path key={`t${k}`} d={seg(x(s.from), 0, x(s.to), mid)} stroke={stroke(s.color)} strokeWidth={2} fill="none" />)}
      {row.bottom.map((s, k) => <path key={`b${k}`} d={seg(x(s.from), mid, x(s.to), h)} stroke={stroke(s.color)} strokeWidth={2} fill="none" />)}
      <circle cx={x(row.lane)} cy={mid} r={4} fill={hl ? "var(--accent)" : stroke(row.color)} stroke="var(--bg)" strokeWidth={1.5} />
    </svg>
  );
}

function Refs({ commit, branch }: { commit: GraphCommit; branch: string | null }) {
  if (commit.refs.length === 0) return null;
  return (
    <span className="git-refs">
      {commit.refs.map((r) => (
        <span
          key={`${r.kind}:${r.name}`}
          className={`git-ref ${r.kind}${r.kind === "local" && r.name === branch ? " hl" : ""}`}
          title={r.mojito ? "Mojito worktree" : r.worktree ? "Checked out in a worktree" : r.kind === "tag" ? "Tag" : undefined}
        >
          {r.worktree && <FolderGit2 size={10} aria-hidden="true" />}
          <span className="git-ref-name">{r.name}</span>
        </span>
      ))}
    </span>
  );
}

export default function GitGraphView(
  { token, target, label, selected, onSelect, onBack }:
  {
    token: string;
    target: GitTarget;
    label: string;
    // The open commit lives in the url (`?commit=`), so Back closes the sheet before it
    // leaves the view and a single commit is linkable — DocsView's `selected`, again.
    selected: string | null;
    onSelect: (hash: string) => void;
    onBack: () => void;
  },
) {
  const [reload, setReload] = useState(0);
  const { page, error, loadMore, loadingMore, moreError } = useGitGraph(token, target, reload);
  const narrow = useNarrow();
  const rowH = narrow ? 40 : 28;
  const layout = useMemo(
    () => (page ? layoutGraph(page.commits, { maxLanes: narrow ? 5 : 12 }) : null),
    [page, narrow],
  );
  const chain = useMemo(
    () => (page?.highlight ? highlightChain(page.commits, page.highlight.tip, page.highlight.baseTip) : new Set<string>()),
    [page],
  );
  const summary = page ? highlightSummary(page.highlight, "ticket" in target) : null;

  // Once per load: bring the highlighted tip on screen if it is not among the first rows.
  const scrolled = useRef(false);
  useEffect(() => { scrolled.current = false; }, [reload]);
  useEffect(() => {
    const tip = page?.highlight?.tip;
    if (!tip || scrolled.current) return;
    scrolled.current = true;
    const i = page!.commits.findIndex((c) => c.hash === tip);
    if (i > 10) document.getElementById(`git-${tip}`)?.scrollIntoView({ block: "center" });
  }, [page]);

  const cols = layout ? Math.min(layout.laneCount, narrow ? 5 : 12) || 1 : 1;

  return (
    <div className="docs-root">
      <header className="docs-head">
        <button className="back icon" aria-label="Back" onClick={onBack}>
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
        <span className="name">{`${page?.label ?? label} · git`}</span>
        <span className="grow" />
        {layout && layout.hiddenLanes > 0 && <span className="git-lanes-more">+{layout.hiddenLanes} lanes</span>}
        <button className="btn sm icon" aria-label="Reload" onClick={() => setReload((n) => n + 1)}>
          <RotateCw size={14} aria-hidden="true" />
        </button>
      </header>
      {summary && <div className={`git-strip${page?.highlight ? " hl" : ""}`}>{summary}</div>}
      <div className="docs-scroll">
        {error ? <p className="empty">{error}</p>
        : !page || !layout ? <p className="empty">Loading…</p>
        : page.commits.length === 0 ? <p className="empty">No commits yet.</p>
        : (
          <>
            {page.commits.map((c, i) => {
              const hl = chain.has(c.hash);
              return (
                <button
                  key={c.hash}
                  id={`git-${c.hash}`}
                  className={`git-row${hl ? " hl" : chain.size > 0 ? " dim" : ""}`}
                  style={{ height: rowH }}
                  aria-label={c.subject}
                  aria-current={c.hash === selected ? "true" : undefined}
                  onClick={() => onSelect(c.hash)}
                >
                  <Lanes row={layout.rows[i]} cols={cols} h={rowH} hl={hl} />
                  <span className="git-text">
                    <span className="git-line">
                      <Refs commit={c} branch={page.highlight?.branch ?? null} />
                      <span className="git-subj">{c.subject}</span>
                    </span>
                    <span className="git-meta">{c.hash.slice(0, 7)} · {relativeTime(c.date)}</span>
                  </span>
                </button>
              );
            })}
            {page.hasMore && (
              <button className="btn ghost sm git-more" disabled={loadingMore} onClick={loadMore}>
                {loadingMore ? "Loading…" : moreError ? "Retry" : "Load more"}
              </button>
            )}
          </>
        )}
      </div>
      {selected && <CommitSheet token={token} target={target} hash={selected} onClose={onBack} />}
    </div>
  );
}

function CommitSheet({ token, target, hash, onClose }: { token: string; target: GitTarget; hash: string; onClose: () => void }) {
  const { details, error } = useGitCommit(token, target, hash);
  return (
    <div className="sheet-backdrop git-sheet" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={`Commit ${hash.slice(0, 7)}`} onClick={(e) => e.stopPropagation()}>
        <div className="git-sheet-head">
          <h3 className="sheet-title">{hash.slice(0, 10)}</h3>
          <button className="btn sm icon" aria-label="Close" onClick={onClose}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>
        {error ? <p className="err-text">{error}</p>
        : !details ? <p className="empty">Loading…</p>
        : (
          <>
            <p className="git-meta git-who">
              {details.author} &lt;{details.email}&gt; · {new Date(details.date).toLocaleString()}
            </p>
            <p className="git-meta">{details.hash}</p>
            <pre className="git-msg">{details.message}</pre>
            <ul className="git-files">
              {details.files.map((f) => (
                <li key={`${f.status}:${f.from ?? ""}:${f.path}`}>
                  <span className={`st ${f.status}`}>{f.status}</span>
                  <span>{f.from ? `${f.from} → ${f.path}` : f.path}</span>
                </li>
              ))}
            </ul>
            {details.moreFiles > 0 && <p className="git-meta">…and {details.moreFiles} more</p>}
          </>
        )}
      </div>
    </div>
  );
}
