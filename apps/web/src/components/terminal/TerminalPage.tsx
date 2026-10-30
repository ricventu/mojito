import { useState } from "react";
import type { Terminal } from "@xterm/xterm";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileText, GitGraph, PanelLeft, Power } from "lucide-react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import type { SessionKind, SessionMeta, TicketSummary } from "@mojito/shared";
import { StateBadge } from "@/components/StateBadge";
import { SessionSidebar } from "@/components/sidebar/SessionSidebar";
import { AccessoryBar } from "@/components/terminal/AccessoryBar";
import { Composer } from "@/components/terminal/Composer";
import { CopyBuffer } from "@/components/terminal/CopyBuffer";
import { TerminalView } from "@/components/terminal/TerminalView";
import { Button } from "@/components/ui/button";
import { useKeyboardOpen } from "@/hooks/useKeyboardOpen";
import { useSessions } from "@/hooks/useSessions";
import { useSidebar } from "@/hooks/useSidebar";
import { useTickets } from "@/hooks/useTickets";
import { ApiError, apiFetch } from "@/lib/api";
import { boardHref } from "@/lib/boardReturn";
import { docsHref } from "@/lib/docs/url";
import { gitHref } from "@/lib/git/url";
import { qk } from "@/lib/queryKeys";
import { safeHref } from "@/lib/url";
import { attachImages, uploadImages } from "@/lib/terminal/imageInput";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<SessionKind, string> = { ticket: "Ticket", claude: "Claude", shell: "Shell" };

/**
 * Who the session is: the ticket (id, live status and title) or `<kind> · <project>`, in whatever
 * width the header leaves: the title gives way first, then the status, the id last.
 */
function Identity({ session, ticket }: { session: SessionMeta; ticket: TicketSummary | undefined }) {
  if (session.ticket) {
    const href = safeHref(ticket?.url);
    // Never paints over the badge. The id ellipsizes rather than being clipped into another
    // ticket's id (RIC-505 shown as RIC-5); status and title share one truncating span, so their
    // spacing goes with them instead of eating the id's width.
    return (
      <div className="flex min-w-0 flex-1 items-center overflow-hidden text-sm">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 truncate font-mono font-semibold underline-offset-2 hover:underline"
          >
            {session.ticket}
          </a>
        ) : (
          <span className="min-w-0 truncate font-mono font-semibold">{session.ticket}</span>
        )}
        {ticket && (
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            <span className="ml-2 text-xs">{ticket.statusName}</span>
            <span className="ml-2">{ticket.title}</span>
          </span>
        )}
      </div>
    );
  }
  return (
    <div className="min-w-0 flex-1 truncate text-sm font-medium">
      {KIND_LABEL[session.kind]}
      <span className="font-normal text-muted-foreground"> · {session.project ?? "General"}</span>
    </div>
  );
}

/**
 * `/session/:id`: the header and the terminal. The fixed root is pinned to the visible
 * band (`useKeyboardOpen`) and pays the top safe-area inset itself — not the header, which
 * unmounts while the keyboard is up and would take the terminal back under the clock.
 */
export function TerminalPage() {
  const { id = "" } = useParams();
  const sessions = useSessions();
  const tickets = useTickets();
  const band = useKeyboardOpen();
  const sidebar = useSidebar();
  const navigate = useNavigate();
  const qc = useQueryClient();
  // Keyed by id: the route reuses this component when one terminal links to another.
  const [goneId, setGoneId] = useState<string | null>(null);
  const gone = goneId === id;
  // The live xterm, handed up by TerminalView, for the accessory bar and its two panels.
  const [term, setTerm] = useState<Terminal | null>(null);
  // At most one panel: both take their room from the terminal's box. Keyed by id like
  // `goneId`, so a panel open on one terminal does not follow a link to the next.
  const [panelState, setPanel] = useState<{ id: string; kind: "compose" | "copy" } | null>(null);
  const panel = panelState?.id === id ? panelState.kind : null;
  const togglePanel = (kind: "compose" | "copy") => setPanel(panel === kind ? null : { id, kind });

  // Images pasted or dropped on the terminal, or picked from the accessory bar: uploaded,
  // then their paths pasted into claude (imageInput.ts). Its `[Image #N]` is the success.
  const attach = (files: File[]) => {
    if (!term || files.length === 0) return;
    const toastId = toast.loading(files.length === 1 ? "Uploading image…" : `Uploading ${files.length} images…`);
    void attachImages(files, { upload: (fs) => uploadImages(id, fs), paste: (text) => term.paste(text) }).then((r) => {
      if (r.ok) toast.dismiss(toastId);
      else toast.error(r.error, { id: toastId });
    });
  };

  const session = sessions.data?.find((s) => s.id === id);
  // A markdown path claude printed opens in its project's docs; General sessions have none.
  const docsProject = session?.project ?? null;
  const openDoc = docsProject
    ? (path: string) => void navigate(docsHref(docsProject, { ticket: session?.ticket, path }))
    : undefined;
  const ticket = session?.ticket ? tickets.data?.tickets.find((t) => t.identifier === session.ticket) : undefined;

  const kill = useMutation({
    mutationFn: () => apiFetch<unknown>(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.sessions });
      navigate(boardHref());
    },
    // A 409 means claude would not leave: the session is untouched and this terminal is the way to it.
    onError: (e) =>
      toast.error(
        e instanceof ApiError && e.status === 409
          ? "claude did not exit: open the terminal"
          : e instanceof Error
            ? e.message
            : "Kill failed",
      ),
  });

  // Unknown only once the list has really answered: a launch navigates here while its
  // refetch is still in flight.
  if (sessions.isSuccess && !sessions.isFetching && !session) return <Navigate to={boardHref()} replace />;

  return (
    // The bottom inset is the root's to pay only where the accessory bar is not: a fine
    // pointer hides it, and the "terminated" panel never mounts it, touch or not. Where
    // the bar is mounted on a touch screen it pays the inset itself. Never with the
    // keyboard up, whose top edge is then the band's bottom.
    <div
      className={cn(
        "fixed inset-x-0 top-0 flex h-dvh flex-row overscroll-none bg-background pt-[var(--sat)] pr-[var(--sar)] pl-[var(--sal)]",
        !band.open && (gone ? "pb-[var(--sab)]" : "pb-[var(--sab)] pointer-coarse:pb-0"),
      )}
      style={band.rootStyle}
    >
      {/* Docked, the sidebar is a column beside the terminal: TerminalView's ResizeObserver
          re-fits once on dock and undock. Not while the keyboard is up, nor with a width
          transition, which would finish after the re-fit. */}
      {!(band.open && sidebar.docked) && (
        <SessionSidebar
          sidebar={sidebar}
          currentId={id}
          replace
          dockedClassName={gone ? undefined : "pointer-coarse:pb-[var(--sab)]"}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        {!band.open && (
          <header className="flex items-center gap-2 border-b px-3 py-2">
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0"
              aria-label="Sessions"
              aria-expanded={sidebar.open}
              onClick={sidebar.toggle}
            >
              <PanelLeft size={16} />
            </Button>
            <Button asChild variant="ghost" size="sm" className="shrink-0">
              <Link to={boardHref()}>
                <ArrowLeft size={16} /> <span className="max-[480px]:sr-only">Board</span>
              </Link>
            </Button>
            {session ? <Identity session={session} ticket={ticket} /> : <div className="flex-1" />}
            {session?.state === "needs-input" && session.alert && (
              <span className="min-w-0 shrink truncate text-xs text-amber-700 dark:text-amber-300">
                {session.alert}
              </span>
            )}
            {session && <StateBadge state={session.state} className="shrink-0" />}
            {session?.project && (
              <Button asChild variant="ghost" size="icon-sm" className="shrink-0">
                <Link
                  to={gitHref(session.project, { ticket: session.ticket ?? undefined })}
                  aria-label={`Git graph of ${session.project}`}
                  title="Git graph"
                >
                  <GitGraph size={16} />
                </Link>
              </Button>
            )}
            {session?.project && (
              <Button asChild variant="ghost" size="icon-sm" className="shrink-0">
                <Link
                  to={docsHref(session.project, { ticket: session.ticket })}
                  aria-label={`Docs of ${session.project}`}
                  title="Docs"
                >
                  <FileText size={16} />
                </Link>
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              disabled={!session || kill.isPending}
              onClick={() => {
                if (window.confirm("Kill this session?")) kill.mutate();
              }}
            >
              <Power size={16} /> <span className="max-[480px]:sr-only">Kill</span>
            </Button>
          </header>
        )}
        {gone ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-[#08090a] p-6 text-center text-neutral-300">
            <p className="text-sm">Session ended</p>
            <Button asChild variant="secondary" size="sm">
              <Link to={boardHref()}>
                <ArrowLeft size={16} /> Back to the board
              </Link>
            </Button>
          </div>
        ) : (
          <>
            <TerminalView
              sessionId={id}
              keyboardOpen={band.open}
              onExit={() => setGoneId(id)}
              onReady={setTerm}
              onImages={attach}
              openDoc={openDoc}
            />
            {term && panel === "compose" && <Composer term={term} onClose={() => setPanel(null)} />}
            {term && panel === "copy" && <CopyBuffer term={term} onClose={() => setPanel(null)} />}
            <AccessoryBar
              term={term}
              keyboardOpen={band.open}
              onCompose={() => togglePanel("compose")}
              onAttach={attach}
              onCopy={() => togglePanel("copy")}
            />
          </>
        )}
      </div>
    </div>
  );
}
