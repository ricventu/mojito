import { useState } from "react";
import type { Terminal } from "@xterm/xterm";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileText, GitGraph, Power } from "lucide-react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import type { SessionMeta } from "@mojito/shared";
import { StateBadge } from "@/components/StateBadge";
import { useKeyboardUp } from "@/components/AppShell";
import { SidebarToggle } from "@/components/sidebar/SidebarToggle";
import { AccessoryBar } from "@/components/terminal/AccessoryBar";
import { Composer } from "@/components/terminal/Composer";
import { CopyBuffer } from "@/components/terminal/CopyBuffer";
import { ImageViewer } from "@/components/terminal/ImageViewer";
import { TerminalView } from "@/components/terminal/TerminalView";
import { Button } from "@/components/ui/button";
import { useHost } from "@/hooks/useHost";
import { useKeyboardOpen } from "@/hooks/useKeyboardOpen";
import { useSessions } from "@/hooks/useSessions";
import { useTickets } from "@/hooks/useTickets";
import { ApiError, apiFetch } from "@/lib/api";
import { boardHref } from "@/lib/boardReturn";
import { docsHref } from "@/lib/docs/url";
import { gitHref } from "@/lib/git/url";
import { hostApi, hostOf } from "@/lib/host";
import { exitAction, peerSessionView } from "@/lib/peerSession";
import { qk } from "@/lib/queryKeys";
import { sessionName } from "@/lib/sidebar";
import { safeHref } from "@/lib/url";
import { attachImages, uploadImages } from "@/lib/terminal/imageInput";
import { cn } from "@/lib/utils";

/**
 * Who the session is: the ticket (id, live status and title) or `<name> · <project>`, in whatever
 * width the header leaves: the title gives way first, then the status, the id last. A peer's
 * ticket is its title alone: no status, no link (its Linear is not read by this instance).
 */
function Identity({
  session,
  ticket,
}: {
  session: SessionMeta;
  ticket: { title: string; statusName?: string; url?: string } | undefined;
}) {
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
            {ticket.statusName && <span className="ml-2 text-xs">{ticket.statusName}</span>}
            <span className="ml-2">{ticket.title}</span>
          </span>
        )}
      </div>
    );
  }
  return (
    <div className="min-w-0 flex-1 truncate text-sm font-medium">
      {sessionName(session)}
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
  useKeyboardUp(band.open);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const host = useHost();
  // The peer's name; null for this instance and for a host not resolved yet (nothing uses it then).
  const hostName = hostOf(host);
  // Keyed by host and id: the route reuses this component when one terminal links to another,
  // and two machines can hold the same id (`mj-RIC-49`).
  const scope = `${hostName ?? ""}\n${id}`;
  const [goneScope, setGoneScope] = useState<string | null>(null);
  const gone = goneScope === scope;
  // The last row of a peer's session this page saw: the snapshot drops it when the session
  // ends or the peer goes offline, and the header must not blank (nor 4404 mean "never was").
  const [known, setKnown] = useState<{ scope: string; session: SessionMeta } | null>(null);
  const peerRow = host.kind === "peer" ? host.peer.sessions.find((s) => s.id === id) : undefined;
  if (peerRow && known?.session !== peerRow) setKnown({ scope, session: peerRow });
  const lastKnown = known?.scope === scope ? known.session : null;
  // The live xterm, handed up by TerminalView, for the accessory bar and its two panels.
  const [term, setTerm] = useState<Terminal | null>(null);
  // At most one panel: both take their room from the terminal's box. Keyed by scope like
  // `goneScope`, so a panel open on one terminal does not follow a link to the next.
  const [panelState, setPanel] = useState<{ scope: string; kind: "compose" | "copy" } | null>(null);
  const panel = panelState?.scope === scope ? panelState.kind : null;
  const togglePanel = (kind: "compose" | "copy") => setPanel(panel === kind ? null : { scope, kind });
  // An image path tapped in the output, shown over the terminal. Keyed by scope, as the panels.
  const [imageState, setImage] = useState<{ scope: string; path: string } | null>(null);
  const image = imageState?.scope === scope ? imageState.path : null;

  // Images pasted or dropped on the terminal, or picked from the accessory bar: uploaded,
  // then their paths pasted into claude (imageInput.ts). Its `[Image #N]` is the success.
  const attach = (files: File[]) => {
    if (!term || files.length === 0) return;
    const toastId = toast.loading(files.length === 1 ? "Uploading image…" : `Uploading ${files.length} images…`);
    void attachImages(files, { upload: (fs) => uploadImages(hostName, id, fs), paste: (text) => term.paste(text) }).then((r) => {
      if (r.ok) toast.dismiss(toastId);
      else toast.error(r.error, { id: toastId });
    });
  };

  // This instance's list, or — for a peer — its snapshot's row (kept once seen).
  const peerView = host.kind === "peer" ? peerSessionView(host.peer, id, lastKnown) : null;
  const offline = peerView?.offline ?? false;
  const session = peerView ? peerView.session : sessions.data?.find((s) => s.id === id);
  // A markdown path claude printed opens in its project's docs; General sessions have none.
  const docsProject = session?.project ?? null;
  const openDoc = docsProject
    ? (path: string) => void navigate(docsHref(docsProject, { host: hostName, ticket: session?.ticket, path }))
    : undefined;
  // A peer's ticket is known by its title alone (`ticketTitles`); this instance's by its summary.
  const peerTitle = host.kind === "peer" && session?.ticket ? host.peer.ticketTitles[session.ticket] : undefined;
  const ticket =
    host.kind === "peer"
      ? peerTitle === undefined
        ? undefined
        : { title: peerTitle }
      : session?.ticket
        ? tickets.data?.tickets.find((t) => t.identifier === session.ticket)
        : undefined;

  const kill = useMutation({
    mutationFn: () => apiFetch<unknown>(hostApi(hostName, `/api/sessions/${encodeURIComponent(id)}`), { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: hostName === null ? qk.sessions : qk.peers });
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

  // A host nobody knows is not found, never this instance's session under that id.
  if (host.kind === "unknown") return <Navigate to={boardHref()} replace />;
  // Unknown only once the list has really answered: a launch navigates here while its
  // refetch is still in flight. A peer's session is not in this list; its terminal is the
  // judge (a 4404 on a session never seen goes to the board, `exitAction`).
  if (host.kind === "self" && sessions.isSuccess && !sessions.isFetching && !session)
    return <Navigate to={boardHref()} replace />;

  return (
    // The bottom inset is the root's to pay only where the accessory bar is not: a fine
    // pointer hides it, and the "terminated" panel never mounts it, touch or not. Where
    // the bar is mounted on a touch screen it pays the inset itself. Never with the
    // keyboard up, whose top edge is then the band's bottom. It starts after a docked sidebar
    // (AppShell): TerminalView's ResizeObserver re-fits once on dock and undock — never while
    // the keyboard is up, when the shell takes a docked sidebar away (`useKeyboardUp`).
    <div
      className={cn(
        "fixed top-0 right-0 left-[var(--dock-width)] flex h-dvh flex-row overscroll-none bg-background pt-[var(--sat)] pr-[var(--sar)] pl-[var(--sal)]",
        !band.open && (gone ? "pb-[var(--sab)]" : "pb-[var(--sab)] pointer-coarse:pb-0"),
      )}
      style={band.rootStyle}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        {!band.open && (
          <header className="flex items-center gap-2 border-b px-3 py-2">
            <SidebarToggle />
            <Button asChild variant="ghost" size="sm" className="shrink-0">
              <Link to={boardHref()}>
                <ArrowLeft size={16} /> <span className="max-[480px]:sr-only">Board</span>
              </Link>
            </Button>
            {session ? (
              <Identity session={session} ticket={ticket} />
            ) : host.kind === "peer" ? (
              // Cold load, before the snapshot has the row: the url's id is all there is.
              <div className="min-w-0 flex-1 truncate font-mono text-sm">{id}</div>
            ) : (
              <div className="flex-1" />
            )}
            {host.kind === "peer" && (
              <span className="shrink-0 text-xs text-muted-foreground">
                on {host.peer.name}
                {offline && " · offline"}
              </span>
            )}
            {session?.state === "needs-input" && session.alert && (
              <span className="min-w-0 shrink truncate text-xs text-amber-700 dark:text-amber-300">
                {session.alert}
              </span>
            )}
            {session && <StateBadge state={session.state} className="shrink-0" />}
            {session?.project && (
              <Button asChild variant="ghost" size="icon-sm" className="shrink-0">
                <Link
                  to={gitHref(session.project, { host: hostName, ticket: session.ticket ?? undefined })}
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
                  to={docsHref(session.project, { host: hostName, ticket: session.ticket })}
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
            {/* A host still being resolved has nothing to attach to: no terminal, no socket. */}
            {host.kind !== "loading" && (
              <TerminalView
                host={hostName}
                sessionId={id}
                keyboardOpen={band.open}
                onExit={() => {
                  if (exitAction(hostName, lastKnown !== null) === "ended") setGoneScope(scope);
                  else navigate(boardHref(), { replace: true });
                }}
                onReady={setTerm}
                onImages={attach}
                openDoc={openDoc}
                openImage={(path) => setImage({ scope, path })}
              />
            )}
            {term && panel === "compose" && <Composer term={term} onClose={() => setPanel(null)} />}
            {term && panel === "copy" && <CopyBuffer term={term} onClose={() => setPanel(null)} />}
            {image && (
              <ImageViewer key={image} host={hostName} sessionId={id} path={image} onClose={() => setImage(null)} />
            )}
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
