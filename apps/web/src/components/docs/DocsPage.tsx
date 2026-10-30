import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, RotateCw } from "lucide-react";
import { Link, Navigate, useParams, useSearchParams } from "react-router";
import type { DocEntry } from "@mojito/shared";
import { Button } from "@/components/ui/button";
import { useDocFile, useDocList } from "@/hooks/useDocs";
import { useBackOr } from "@/hooks/useGitGraph";
import { ApiError } from "@/lib/api";
import { boardHref } from "@/lib/boardReturn";
import { docGroups, docLabel } from "@/lib/docs/list";
import { docsHref, parseDocsSearch } from "@/lib/docs/url";
import { relativeTime } from "@/lib/git/time";
import { docKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { MarkdownView } from "./MarkdownView";

/** `/docs/:project`: a project's markdown, read-only. State lives in the url (`lib/docs/url.ts`). */
export function DocsPage() {
  const { project } = useParams();
  if (!project) return <Navigate to="/" replace />;
  return <DocsView project={project} />;
}

function DocsView({ project }: { project: string }) {
  const [params] = useSearchParams();
  const { ticket, path } = parseDocsSearch(params);
  const back = useBackOr();
  const qc = useQueryClient();
  // The list is not read under an open document: the document view never shows it.
  const list = useDocList(project, ticket, path === null);
  const file = useDocFile(project, ticket, path);
  const fetching = path ? file.isFetching : list.isFetching;
  const label = path ? docLabel(path) : null;

  const reload = () => void qc.resetQueries({ queryKey: docKeys.project(project) });

  return (
    <main className="flex min-h-dvh flex-col pr-[var(--sar)] pb-[var(--sab)] pl-[var(--sal)]">
      {/* Sticky, so Back and Reload stay in reach down a long document: it pays the top inset itself. */}
      <div className="sticky top-0 z-10 border-b bg-background pt-[var(--sat)]">
        <header className="mx-auto flex w-full max-w-3xl items-center gap-2 px-3 py-2">
          <Button variant="ghost" size="sm" className="shrink-0" onClick={() => back(path ? docsHref(project, { ticket }) : boardHref())}>
            <ArrowLeft size={16} /> <span className="max-[480px]:sr-only">Back</span>
          </Button>
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold">
            {label ? (
              label.name
            ) : (
              <>
                {project}
                <span className="font-normal text-muted-foreground"> · docs</span>
              </>
            )}
          </h1>
          <Button variant="ghost" size="icon-sm" className="shrink-0" aria-label="Reload" onClick={reload}>
            <RotateCw size={16} className={cn(fetching && "animate-spin")} />
          </Button>
        </header>
        {label?.dir && <Dir className="mx-auto w-full max-w-3xl px-4 pb-2">{label.dir}</Dir>}
      </div>

      <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-1 flex-col">
        {path ? (
          file.isPending ? (
            <Spinner />
          ) : file.data ? (
            <article className="px-4 py-4">
              <MarkdownView content={file.data.content} project={project} ticket={ticket} path={path} />
            </article>
          ) : (
            <Failure error={file.error} path={path} onReload={reload} onBack={() => back(boardHref())} />
          )
        ) : list.isPending ? (
          <Spinner />
        ) : !list.data ? (
          <Failure error={list.error} path={null} onReload={reload} onBack={() => back(boardHref())} />
        ) : list.data.docs.length === 0 ? (
          <Centered>
            <p className="text-sm text-muted-foreground">No markdown documents.</p>
          </Centered>
        ) : (
          <DocLists groups={docGroups(list.data, ticket)} ticket={ticket} project={project} />
        )}
      </div>
    </main>
  );
}

function DocLists({ groups, ticket, project }: { groups: ReturnType<typeof docGroups>; ticket: string | null; project: string }) {
  const rows = (docs: DocEntry[]) => (
    <ul className="flex flex-col">
      {docs.map((d) => (
        <li key={d.path}>
          <DocRow doc={d} href={docsHref(project, { ticket, path: d.path })} />
        </li>
      ))}
    </ul>
  );
  if (!groups.ticket) return <div className="py-1">{rows(groups.all)}</div>;
  return (
    <div className="flex flex-col gap-2 py-2">
      <section>
        <GroupHeading>{ticket}</GroupHeading>
        {groups.ticket.length > 0 ? (
          rows(groups.ticket)
        ) : (
          <p className="px-4 py-2 text-sm text-muted-foreground">No documents for {ticket}</p>
        )}
      </section>
      <section>
        <GroupHeading>All documents</GroupHeading>
        {rows(groups.all)}
      </section>
    </div>
  );
}

function GroupHeading({ children }: { children: ReactNode }) {
  return <h2 className="px-4 py-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{children}</h2>;
}

function DocRow({ doc, href }: { doc: DocEntry; href: string }) {
  const { name, dir } = docLabel(doc.path);
  return (
    <Link to={href} className="flex min-h-11 flex-col justify-center px-4 py-1.5 hover:bg-accent">
      <span className="truncate text-sm font-medium">{name}</span>
      <span className="flex min-w-0 gap-1 text-xs text-muted-foreground">
        {dir && (
          <>
            <Dir className="min-w-0">{dir}</Dir>
            <span aria-hidden>·</span>
          </>
        )}
        <span className="shrink-0">{relativeTime(doc.mtime)}</span>
      </span>
    </Link>
  );
}

/** A directory, ellipsized on the left: the end of a path tells more than its start. */
function Dir({ children, className }: { children: string; className?: string }) {
  return (
    <span className={cn("truncate text-left text-xs text-muted-foreground [direction:rtl]", className)}>
      <bdi>{children}</bdi>
    </span>
  );
}

function Failure(props: { error: Error | null; path: string | null; onReload: () => void; onBack: () => void }) {
  const status = props.error instanceof ApiError ? props.error.status : null;
  if (status === 404 && props.path === null) {
    return (
      <Centered>
        <p className="text-sm">Unknown project</p>
        <Button variant="secondary" size="sm" onClick={props.onBack}>
          <ArrowLeft size={16} /> Back
        </Button>
      </Centered>
    );
  }
  const message =
    props.path !== null && status === 404
      ? "Document not found"
      : status === 413
        ? "Too large to display (over 512 KB)."
        : status === 400 && props.path !== null
          ? "Not a markdown file in this project."
          : (props.error?.message ?? "Could not read the documents");
  return (
    <Centered>
      <p className="max-w-md text-sm wrap-anywhere whitespace-pre-wrap text-muted-foreground">{message}</p>
      {props.path !== null && status === 404 && <p className="font-mono text-xs wrap-anywhere">{props.path}</p>}
      <Button variant="secondary" size="sm" onClick={props.onReload}>
        <RotateCw size={16} /> Reload
      </Button>
    </Centered>
  );
}

function Spinner() {
  return (
    <Centered>
      <Loader2 size={20} className="animate-spin text-muted-foreground" aria-label="Loading" />
    </Centered>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">{children}</div>;
}
