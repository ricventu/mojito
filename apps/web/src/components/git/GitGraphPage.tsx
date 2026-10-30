import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FolderGit2, Loader2, RotateCw } from "lucide-react";
import { Link, Navigate, useParams, useSearchParams } from "react-router";
import type { GraphCommit, GraphRef } from "@mojito/shared";
import { Button } from "@/components/ui/button";
import { useBackOr, useGitGraph } from "@/hooks/useGitGraph";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { ApiError } from "@/lib/api";
import { boardHref } from "@/lib/boardReturn";
import { highlightChain, highlightSummary } from "@/lib/git/highlight";
import { layoutGraph, type GraphRow } from "@/lib/git/layout";
import { relativeTime } from "@/lib/git/time";
import { gitHref, parseGitSearch } from "@/lib/git/url";
import { gitKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { GraphLanes } from "./GraphLanes";

/** The highlighted tip is scrolled into view on first load only when it is past this many rows. */
const SCROLL_PAST = 10;

/** `/git/:project`: a project's commits, branches and tags, read-only. State lives in the url (`lib/git/url.ts`). */
export function GitGraphPage() {
  const { project } = useParams();
  if (!project) return <Navigate to="/" replace />;
  return <GraphView project={project} />;
}

function GraphView({ project }: { project: string }) {
  const [params] = useSearchParams();
  const view = parseGitSearch(params);
  const { ticket } = view;
  const back = useBackOr();
  const qc = useQueryClient();
  const graph = useGitGraph(project, ticket);
  const narrow = useMediaQuery("(max-width: 479px)");
  const rowHeight = narrow ? 44 : 32;
  const maxLanes = narrow ? 5 : 12;

  const pages = graph.data?.pages;
  const first = pages?.[0];
  const commits = useMemo(() => pages?.flatMap((p) => p.commits) ?? [], [pages]);
  const layout = useMemo(() => layoutGraph(commits, { maxLanes }), [commits, maxLanes]);
  const cols = Math.max(1, Math.min(layout.laneCount, maxLanes));
  const highlight = first?.highlight ?? null;
  const chain = useMemo(
    () => (highlight ? highlightChain(commits, highlight.tip, highlight.baseTip) : new Set<string>()),
    [commits, highlight],
  );
  const summary = first ? highlightSummary(highlight, ticket) : null;

  // On first load, bring the highlighted tip into view when it is not among the first rows.
  const scrolledFor = useRef<string | null>(null);
  const queryId = `${project}\0${ticket ?? ""}`;
  useEffect(() => {
    if (!first || scrolledFor.current === queryId) return;
    scrolledFor.current = queryId;
    const tip = first.highlight?.tip;
    if (!tip) return;
    if (commits.findIndex((c) => c.hash === tip) > SCROLL_PAST) {
      document.getElementById(`git-${tip}`)?.scrollIntoView({ block: "center" });
    }
  }, [first, commits, queryId]);

  const reload = () => {
    scrolledFor.current = null;
    window.scrollTo({ top: 0 });
    void qc.resetQueries({ queryKey: gitKeys.graph(project, ticket) });
  };

  return (
    <main className="flex min-h-dvh flex-col pr-[var(--sar)] pb-[var(--sab)] pl-[var(--sal)]">
      {/* Sticky, so Back and Reload stay in reach down a long log: it pays the top inset itself. */}
      <div className="sticky top-0 z-10 border-b bg-background pt-[var(--sat)]">
        <header className="mx-auto flex w-full max-w-5xl items-center gap-2 px-3 py-2">
          <Button variant="ghost" size="sm" className="shrink-0" onClick={() => back(boardHref())}>
            <ArrowLeft size={16} /> <span className="max-[480px]:sr-only">Back</span>
          </Button>
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold">
            {project}
            <span className="font-normal text-muted-foreground"> · git</span>
          </h1>
          {layout.hiddenLanes > 0 && (
            <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">+{layout.hiddenLanes} lanes</span>
          )}
          <Button variant="ghost" size="icon-sm" className="shrink-0" aria-label="Reload" onClick={reload}>
            <RotateCw size={16} className={cn(graph.isFetching && !graph.isFetchingNextPage && "animate-spin")} />
          </Button>
        </header>
        {summary && (
          <p className="mx-auto w-full max-w-5xl px-4 pb-2 font-mono text-xs wrap-anywhere text-muted-foreground">
            {summary}
          </p>
        )}
      </div>

      <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-1 flex-col">
        {graph.isPending ? (
          <Centered>
            <Loader2 size={20} className="animate-spin text-muted-foreground" aria-label="Loading" />
          </Centered>
        ) : !graph.data ? (
          graph.error instanceof ApiError && graph.error.status === 404 ? (
            <Centered>
              <p className="text-sm">Unknown project</p>
              <Button variant="secondary" size="sm" onClick={() => back(boardHref())}>
                <ArrowLeft size={16} /> Back
              </Button>
            </Centered>
          ) : (
            <Centered>
              <p className="max-w-md text-sm wrap-anywhere whitespace-pre-wrap text-muted-foreground">
                {graph.error?.message ?? "Could not read the graph"}
              </p>
              <Button variant="secondary" size="sm" onClick={reload}>
                <RotateCw size={16} /> Reload
              </Button>
            </Centered>
          )
        ) : commits.length === 0 ? (
          <Centered>
            <p className="text-sm text-muted-foreground">No commits yet.</p>
          </Centered>
        ) : (
          <>
            <ol className="flex flex-col py-1">
              {commits.map((c, i) => (
                <li key={c.hash}>
                  <CommitRow
                    commit={c}
                    row={layout.rows[i]!}
                    cols={cols}
                    height={rowHeight}
                    narrow={narrow}
                    href={gitHref(project, { ticket, commit: c.hash })}
                    current={c.hash === view.commit}
                    inChain={chain.has(c.hash)}
                    dimmed={chain.size > 0 && !chain.has(c.hash)}
                    highlightBranch={highlight?.branch ?? null}
                  />
                </li>
              ))}
            </ol>
            {graph.isFetchNextPageError ? (
              <div className="flex justify-center py-3">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={graph.isFetchingNextPage}
                  onClick={() => void graph.fetchNextPage()}
                >
                  <RotateCw size={16} /> Retry
                </Button>
              </div>
            ) : (
              graph.hasNextPage && (
                <Sentinel loading={graph.isFetchingNextPage} onVisible={graph.fetchNextPage} />
              )
            )}
          </>
        )}
      </div>
    </main>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">{children}</div>;
}

/** Loads the next page as it nears the viewport; re-armed after every page, so a short page keeps loading. */
function Sentinel({ loading, onVisible }: { loading: boolean; onVisible: () => unknown }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || loading) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void onVisible();
      },
      { rootMargin: "400px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loading, onVisible]);
  return (
    <div ref={ref} className="flex h-11 items-center justify-center">
      {loading && <Loader2 size={16} className="animate-spin text-muted-foreground" aria-label="Loading more commits" />}
    </div>
  );
}

interface RowProps {
  commit: GraphCommit;
  row: GraphRow;
  cols: number;
  height: number;
  narrow: boolean;
  href: string;
  current: boolean;
  inChain: boolean;
  dimmed: boolean;
  highlightBranch: string | null;
}

/** Below 480px two lines (refs + subject, then hash · date), above one; always the lanes' height. */
function CommitRow({ commit: c, row, cols, height, narrow, href, current, inChain, dimmed, highlightBranch }: RowProps) {
  const short = c.hash.slice(0, 7);
  const when = relativeTime(c.date);
  const chips = c.refs.length > 0 && (
    // Capped, so the chips ellipsize before the subject loses its room.
    <span className="flex max-w-[60%] min-w-0 shrink items-center gap-1">
      {c.refs.map((r) => (
        <RefChip key={`${r.kind}:${r.name}`} gitRef={r} highlighted={r.kind !== "tag" && r.name === highlightBranch} />
      ))}
    </span>
  );
  return (
    <Link
      to={href}
      id={`git-${c.hash}`}
      aria-current={current ? "true" : undefined}
      className={cn(
        "flex min-w-0 items-center gap-2 pr-3 pl-1 outline-none hover:bg-accent/60 focus-visible:bg-accent",
        narrow ? "h-11" : "h-8",
        current && "bg-accent",
        dimmed && "opacity-50",
      )}
    >
      <GraphLanes row={row} cols={cols} height={height} highlighted={inChain} />
      {narrow ? (
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            {chips}
            <span className="min-w-0 flex-1 truncate text-sm">{c.subject}</span>
          </span>
          <span className="truncate text-xs text-muted-foreground">
            <span className="font-mono">{short}</span> · {when}
          </span>
        </span>
      ) : (
        <>
          {chips}
          <span className="min-w-0 flex-1 truncate text-sm">{c.subject}</span>
          <span className="shrink-0 font-mono text-xs text-muted-foreground">{short}</span>
          <span className="w-28 shrink-0 truncate text-right text-xs text-muted-foreground">{when}</span>
        </>
      )}
    </Link>
  );
}

/** Local branch (a folder icon when checked out in a worktree), `origin/…`, or tag, each told apart by its look. */
function RefChip({ gitRef: r, highlighted }: { gitRef: GraphRef; highlighted: boolean }) {
  return (
    <span
      className={cn(
        "flex h-4.5 min-w-0 shrink items-center gap-0.5 rounded px-1 text-[10px] leading-none font-medium",
        highlighted
          ? "bg-primary text-primary-foreground"
          : r.kind === "local"
            ? "bg-secondary text-secondary-foreground"
            : r.kind === "remote"
              ? "border text-muted-foreground"
              : "border border-dashed text-muted-foreground",
      )}
      title={r.kind === "tag" ? `tag ${r.name}` : r.name}
    >
      {r.worktree && <FolderGit2 size={10} className="shrink-0" aria-label="checked out in a worktree" />}
      <span className="truncate">{r.name}</span>
    </span>
  );
}
