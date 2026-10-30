import { useRef } from "react";
import { ChevronLeft, Loader2 } from "lucide-react";
import { useLocation, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { useBackOr, useDiff } from "@/hooks/useGitGraph";
import { ApiError } from "@/lib/api";
import { diffLines, type DiffLineKind } from "@/lib/git/diff";
import { gitHref, parseGitSearch } from "@/lib/git/url";
import { cn } from "@/lib/utils";

const TINT: Record<DiffLineKind, string> = {
  add: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  del: "bg-red-500/10 text-red-800 dark:text-red-300",
  hunk: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  ctx: "",
  note: "text-muted-foreground italic",
};

/**
 * One file's diff in a commit, in the commit sheet in place of the details. The chevron goes back
 * to them; the patch scrolls both ways inside its own box, never widening the page.
 */
export function DiffView({
  project,
  hash,
  file,
  from,
}: {
  project: string;
  hash: string;
  file: string;
  from: string | null;
}) {
  const diff = useDiff(project, hash, file, from);
  const back = useBackOr();
  const [params] = useSearchParams();
  const location = useLocation();
  // As the sheet's ✕: a second tap before the first navigation lands is not a second step back.
  const wentBackFrom = useRef<string | null>(null);
  const toDetails = () => {
    if (wentBackFrom.current === location.key) return;
    wentBackFrom.current = location.key;
    back(gitHref(project, { ticket: parseGitSearch(params).ticket, commit: hash }));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b py-1 pr-4 pl-2">
        <Button variant="ghost" size="icon-sm" className="shrink-0" aria-label="Back to the commit" onClick={toDetails}>
          <ChevronLeft size={16} />
        </Button>
        <p className="min-w-0 flex-1 font-mono text-xs wrap-anywhere">
          {from && (
            <>
              <span className="text-muted-foreground">{from}</span>
              <span className="text-muted-foreground" aria-hidden>
                {" → "}
              </span>
              <span className="sr-only"> to </span>
            </>
          )}
          {file}
        </p>
      </div>
      {diff.data ? (
        diff.data.binary ? (
          <Notice>Binary file — no diff.</Notice>
        ) : diff.data.patch === "" ? (
          <Notice>{diff.data.truncated ? "Diff truncated at 256 KB." : "No changes in this file."}</Notice>
        ) : (
          <pre className="min-h-0 flex-1 overflow-auto pb-[max(1rem,var(--sab))] font-mono text-xs leading-5">
            <span className="block w-max min-w-full py-1">
              {diffLines(diff.data.patch).map((line, i) => (
                <span key={i} className={cn("block px-4 whitespace-pre", TINT[line.kind])}>
                  {line.text || " "}
                </span>
              ))}
            </span>
            {diff.data.truncated && (
              <span className="block px-4 py-2 font-sans text-sm text-muted-foreground">Diff truncated at 256 KB.</span>
            )}
          </pre>
        )
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-[max(1rem,var(--sab))]">
          {diff.isPending ? <Spinner /> : <LoadError error={diff.error} />}
        </div>
      )}
    </div>
  );
}

function Notice({ children }: { children: string }) {
  return <p className="px-4 pt-3 pb-[max(1rem,var(--sab))] text-sm text-muted-foreground">{children}</p>;
}

export function Spinner() {
  return (
    <div className="flex justify-center py-8">
      <Loader2 size={20} className="animate-spin text-muted-foreground" aria-label="Loading" />
    </div>
  );
}

/** A 404 is a commit git does not know; anything else is the server's own message. The sheet stays open. */
export function LoadError({ error }: { error: Error | null }) {
  return (
    <p role="alert" className="text-sm wrap-anywhere whitespace-pre-wrap text-muted-foreground">
      {error instanceof ApiError && error.status === 404 ? "Commit not found" : (error?.message ?? "Could not load")}
    </p>
  );
}
