import { useRef } from "react";
import { Copy, Loader2, X } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import type { CommitDetails, CommitFile, GraphRef } from "@mojito/shared";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { historyIndex, useCommit } from "@/hooks/useGitGraph";
import { gitHref } from "@/lib/git/url";
import { closeMove, diffEntryState } from "@/lib/git/sheetNav";
import { browserClipboard, copyText } from "@/lib/terminal/copySelection";
import { cn } from "@/lib/utils";
import { DiffView, LoadError, Spinner } from "./DiffView";
import { RefChip } from "./RefChip";

interface Props {
  project: string;
  ticket: string | null;
  hash: string;
  file: string | null;
  from: string | null;
  /** The commit's refs from the loaded graph; none when it is not loaded. */
  refs: GraphRef[];
}

/**
 * The open commit (`?commit=`): its details, or one file's diff (`&file=`) in their place. The url
 * is the state: closing it (✕, overlay, Escape) navigates to the graph, and the graph unmounts it.
 */
export function CommitSheet({ project, ticket, hash, file, from, refs }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const commit = useCommit(project, hash);
  const full = commit.data?.hash ?? (hash.length === 40 ? hash : null);

  // A second tap before the first navigation lands must not step back once more (out of the app).
  const closedAt = useRef<string | null>(null);
  const close = () => {
    if (closedAt.current === location.key) return;
    closedAt.current = location.key;
    const move = closeMove(file !== null, historyIndex(), location.state);
    if (move.kind === "back") void navigate(-move.steps);
    else void navigate(gitHref(project, { ticket }), { replace: true });
  };

  const copy = async () => {
    if (!full) return;
    if (await copyText(full, browserClipboard())) toast.success("Hash copied");
    else toast.error("Could not copy the hash");
  };

  return (
    <Sheet open onOpenChange={(open) => !open && close()}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="h-[90dvh] gap-0 rounded-t-xl pr-[var(--sar)] pl-[var(--sal)] sm:mx-auto sm:max-w-5xl"
      >
        <SheetHeader className="shrink-0 flex-row items-center gap-1 border-b py-2 pr-2 pl-4">
          <SheetTitle className="font-mono text-sm">
            <span className="sr-only">Commit </span>
            {hash.slice(0, 7)}
          </SheetTitle>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Copy the full hash"
            disabled={!full}
            onClick={() => void copy()}
          >
            <Copy size={14} />
          </Button>
          <div className="flex-1" />
          <SheetClose asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Close">
              <X size={16} />
            </Button>
          </SheetClose>
          <SheetDescription className="sr-only">
            {file ? `The diff of ${file} in this commit.` : "The commit's message and the files it changed."}
          </SheetDescription>
        </SheetHeader>
        {file ? (
          <DiffView project={project} hash={hash} file={file} from={from} />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-[max(1rem,var(--sab))]">
            {commit.data ? (
              <Details project={project} ticket={ticket} hash={hash} details={commit.data} refs={refs} />
            ) : commit.isPending ? (
              <Spinner />
            ) : (
              <LoadError error={commit.error} />
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Details({
  project,
  ticket,
  hash,
  details: d,
  refs,
}: {
  project: string;
  ticket: string | null;
  hash: string;
  details: CommitDetails;
  refs: GraphRef[];
}) {
  const message = d.message.trimEnd();
  const cut = message.indexOf("\n");
  const subject = cut < 0 ? message : message.slice(0, cut);
  const body = cut < 0 ? "" : message.slice(cut + 1).replace(/^\n+/, "");
  const total = d.files.length + d.moreFiles;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground wrap-anywhere">
          {d.author} · {new Date(d.date).toLocaleString()}
        </p>
        {refs.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {refs.map((r) => (
              <RefChip key={`${r.kind}:${r.name}`} gitRef={r} highlighted={false} className="max-w-full" />
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium wrap-anywhere">{subject}</h2>
        {body && <p className="text-sm wrap-anywhere whitespace-pre-wrap text-muted-foreground">{body}</p>}
      </div>
      <section className="flex flex-col">
        <h3 className="pb-1 text-xs font-medium text-muted-foreground">
          {total === 0 ? "No files changed." : total === 1 ? "1 file" : `${total} files`}
        </h3>
        <ul className="-mx-2 flex flex-col">
          {d.files.map((f) => (
            <li key={`${f.from ?? ""}\0${f.path}`}>
              <FileRow
                file={f}
                href={gitHref(project, { ticket, commit: hash, file: f.path, from: f.from ?? null })}
                state={diffEntryState(historyIndex())}
              />
            </li>
          ))}
        </ul>
        {d.moreFiles > 0 && <p className="pt-1 text-xs text-muted-foreground">…and {d.moreFiles} more</p>}
      </section>
    </div>
  );
}

const STATUS: Record<string, { label: string; className: string }> = {
  A: { label: "Added", className: "text-emerald-600 dark:text-emerald-400" },
  D: { label: "Deleted", className: "text-red-600 dark:text-red-400" },
  M: { label: "Modified", className: "text-amber-600 dark:text-amber-400" },
  R: { label: "Renamed", className: "text-sky-600 dark:text-sky-400" },
  C: { label: "Copied", className: "text-sky-600 dark:text-sky-400" },
  T: { label: "Type changed", className: "text-muted-foreground" },
};

/** A file the commit touched: its status letter and path (`from → path` for a rename or copy); pushes its diff. */
function FileRow({ file: f, href, state }: { file: CommitFile; href: string; state: object }) {
  const status = STATUS[f.status] ?? { label: f.status, className: "text-muted-foreground" };
  return (
    <Link
      to={href}
      state={state}
      className="flex min-h-11 items-center gap-3 rounded-md px-2 py-1 outline-none hover:bg-accent/60 focus-visible:bg-accent"
    >
      <span className={cn("w-3 shrink-0 font-mono text-xs font-semibold", status.className)} title={status.label}>
        <span aria-hidden>{f.status}</span>
        <span className="sr-only">{status.label}:</span>
      </span>
      <span className="min-w-0 flex-1 font-mono text-xs wrap-anywhere">
        {f.from && (
          <>
            <span className="text-muted-foreground">{f.from}</span>
            <span className="text-muted-foreground" aria-hidden>
              {" → "}
            </span>
            <span className="sr-only"> to </span>
          </>
        )}
        {f.path}
      </span>
    </Link>
  );
}
