"use client";
import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useToken } from "@/lib/useToken";
import { useAppLocation } from "@/lib/useAppLocation";
import { useTickets } from "@/lib/useTickets";
import { useSessions } from "@/lib/useSessions";
import { useEvents } from "@/lib/useEvents";
import { useSelfUpdate } from "@/lib/useSelfUpdate";
import TokenGate from "@/components/TokenGate";
import UnifiedList from "@/components/UnifiedList";
import { Settings } from "lucide-react";
import AlertLayer from "@/components/AlertLayer";
import SettingsSheet from "@/components/SettingsSheet";
import NewTicketSheet from "@/components/NewTicketSheet";
import DocsView from "@/components/DocsView";
import { withSession } from "@/lib/launchedSession";
import { newTicketProject } from "@/lib/sheetProject";
import type { AppView, ListFilters } from "@/lib/appLocation";
import type { SessionMeta } from "@/server/types";
import type { MojitoEvent } from "@/server/events";

// xterm/xterm and its addons reference browser-only globals (e.g. `self`) at module
// load time, which crashes Next.js's server-side prerender of this page. Loading
// TerminalView with ssr:false keeps it out of the server bundle entirely.
const TerminalView = dynamic(() => import("@/components/TerminalView"), { ssr: false });

/** Where every in-app Back lands once there is nothing of ours left to go back to. */
const LIST: AppView = { kind: "list" };

/** The tab title for every view but an open terminal, which sets its own. */
const TITLE = "Tickets — Mojito";

// This page is the app's only route, mounted on an optional catch-all so that a
// reload of /session/<id> is served the same client bundle instead of a 404 — see
// appLocation for the url grammar. Unrecognised paths parse as the list, so a stale
// bookmark — /stacks from before RIC-253 folded that panel into the board's project
// dividers — still lands somewhere real.
export default function Home() {
  const { token, setToken } = useToken();
  const { location, navigate, replace, back } = useAppLocation();
  const { view, filters } = location;
  const [alerts, setAlerts] = useState<{ id: string; ticket: string; message: string }[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newTicketOpen, setNewTicketOpen] = useState(false);
  const { tickets, refresh: refreshTickets } = useTickets(token);
  const { sessions, setSessions, loaded: sessionsLoaded, refresh: refreshSessions } = useSessions(token);
  // Owned here — not by the project toolbar or SettingsSheet — so a deploy's health poll
  // and "Deploying…" state survive opening a terminal or a doc, either of which unmounts
  // the board mid-deploy. Called unconditionally, above the token/terminal/docs early
  // returns below, per the rules of hooks; the hook itself no-ops until a token exists.
  const selfUpdate = useSelfUpdate(token);

  // Go to another view, carrying the filters: they ride along on every path, so
  // leaving the list for a terminal or a doc and coming back does not drop them.
  const go = useCallback((next: AppView) => navigate({ view: next, filters }), [navigate, filters]);
  const setFilters = useCallback(
    (next: ListFilters, mode: "push" | "replace") =>
      (mode === "push" ? navigate : replace)({ view, filters: next }),
    [navigate, replace, view],
  );

  const onEvent = useCallback((e: MojitoEvent) => {
    refreshSessions();
    if (e.type === "session.alert") setAlerts((a) => [{ id: e.id, ticket: e.ticket, message: e.message }, ...a].slice(0, 20));
  }, [refreshSessions]);
  // Third argument = resync on every (re)connection, which is what keeps the list from
  // freezing at whatever it last heard; openEventStream explains why. Tickets are left out
  // of it on purpose — they have their own 45s poll, and a flapping connection must not
  // turn into a burst of Linear queries.
  useEvents(token, onEvent, refreshSessions);

  // The other way an event goes missing: a phone that backgrounds this tab can leave the
  // socket half-open — frames are sent into it and no close event ever arrives, so the
  // reconnect resync above never gets its chance. Refetching when the tab comes back
  // covers that, and costs one local request. Sessions only: tickets have their own 45s
  // poll, and this fires every time the user switches away and back.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") refreshSessions(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refreshSessions]);

  // A terminal url whose session is gone — killed from another tab, swept, or simply
  // stale in a bookmark. Correct the address bar rather than leave a blank page, and
  // replace rather than push so Back does not walk straight into the dead url again.
  const openSession = view.kind === "session"
    ? sessions.find((s) => s.id === view.id) ?? null
    : null;
  const missingSession = view.kind === "session" && sessionsLoaded && openSession === null;
  useEffect(() => {
    if (missingSession) replace({ view: LIST, filters });
  }, [missingSession, replace, filters]);

  // Own the browser tab title on the client: the active tab when signed in, the
  // app name on the token gate. Skipped while a terminal is open — TerminalView
  // sets the ticket title and restores this one on close.
  useEffect(() => {
    if (view.kind === "session") return;
    document.title = token ? TITLE : "Mojito";
  }, [view.kind, token]);

  if (!token) return <TokenGate onSet={setToken} />;

  const openTerminal = (id: string) => go({ kind: "session", id, docs: null });
  // Opening a session we were handed the meta for — a launch that just answered, or a
  // stack that was just started. Seed the list with it first: its refresh is still in
  // flight, and an unknown /session/<id> corrects itself back to the board (see
  // missingSession above) before the terminal would ever mount.
  const openLaunched = (s: SessionMeta) => {
    setSessions((prev) => withSession(prev, s));
    openTerminal(s.id);
  };

  // Owned here rather than by the list, because the action that opens it is on the
  // terminal header too (RIC-224) and the list is not mounted there. It is rendered
  // into every branch below for the same reason. Which project it opens on depends on
  // where it was opened from — see newTicketProject.
  const newTicketSheet = newTicketOpen && (
    <NewTicketSheet
      token={token}
      defaultProject={newTicketProject(view, filters, openSession)}
      onClose={() => setNewTicketOpen(false)}
      onCreated={() => { refreshSessions(); refreshTickets(); }}
      onOpen={(s) => { setNewTicketOpen(false); openLaunched(s); }}
    />
  );

  if (view.kind === "session") {
    // Nothing to draw until the session list has answered (see useSessions.loaded);
    // an id that never resolves is corrected by the effect above.
    if (!openSession) return null;
    // One Back button for the whole stack, unwound one step at a time: an open
    // document falls back to the document list, the list to the terminal, the
    // terminal to the ticket list.
    const fallback: AppView = view.docs?.doc != null
      ? { kind: "session", id: view.id, docs: { doc: null } }
      : view.docs != null ? { kind: "session", id: view.id, docs: null } : LIST;
    return (
      <>
      <TerminalView
        token={token}
        session={openSession}
        tickets={tickets}
        docs={view.docs}
        onNewTicket={() => setNewTicketOpen(true)}
        onOpenDocs={() => go({ kind: "session", id: view.id, docs: { doc: null } })}
        onSelectDoc={(doc) => go({ kind: "session", id: view.id, docs: { doc } })}
        onBack={() => {
          back({ view: fallback, filters });
          // Refresh on leaving the terminal: dismiss/advance mutate server state, and a
          // dead session (tmux gone) emits no hook event to trigger a refresh on its own,
          // so without this its card would linger in the list after being deleted.
          if (view.docs === null) refreshSessions();
        }}
      />
      {newTicketSheet}
      </>
    );
  }

  // The overlay opened from a list replaces the page, since there is no terminal to keep alive here.
  if (view.kind === "docs") {
    const target = view.target;
    // The label is derived, never carried in the url: a ticket's is its identifier,
    // which is already in the path, and a session's comes from the session list —
    // falling back to the id while that is still loading, or if it is gone.
    const session = "session" in target ? sessions.find((s) => s.id === target.session) : undefined;
    const label = "ticket" in target
      ? target.ticket
      : session?.ticket || session?.title || target.session;
    return (
      <>
      <DocsView
        token={token}
        target={target}
        label={label}
        selected={view.doc}
        onSelect={(doc) => go({ ...view, doc })}
        onBack={() => back({ view: view.doc !== null ? { ...view, doc: null } : LIST, filters })}
      />
      {newTicketSheet}
      </>
    );
  }

  const needsInput = sessions.filter((s) => s.state === "needs-input").length;

  return (
    // `.page` carries the padding that clears the fixed nav below and the status bar
    // above — see globals.css, and RIC-257 for why the top matters.
    <div className="page">
      <AlertLayer alerts={alerts} onOpen={openTerminal} onClear={() => setAlerts([])} />
      {settingsOpen && <SettingsSheet token={token} onClose={() => setSettingsOpen(false)} selfUpdate={selfUpdate} />}
      {newTicketSheet}
      {/* Every view that is not a terminal or a doc overlay is this list — an
          unrecognised path parses as the list, so it lands somewhere real. */}
      <UnifiedList token={token} tickets={tickets} sessions={sessions}
        filters={filters} onFilters={setFilters} selfUpdate={selfUpdate}
        onLaunched={() => { refreshSessions(); refreshTickets(); }}
        onChanged={refreshSessions}
        onNewTicket={() => setNewTicketOpen(true)}
        onOpen={openLaunched}
        onOpenTicketDocs={(t) => go({ kind: "docs", target: { ticket: t.identifier, project: t.project }, doc: null })}
        onOpenSessionDocs={(s) => go({ kind: "docs", target: { session: s.id }, doc: null })} />
      {/* One destination left since the Stacks tab was folded into the board's project
          dividers (RIC-253), so the bar carries the needs-input count and the settings
          gear rather than a choice: the Tickets entry is where you already are, and
          tapping it re-pushes nothing (see useAppLocation.navigate). */}
      <nav className="nav">
        <button className="tab active" onClick={() => go(LIST)}>
          Tickets{needsInput ? <span className="count">{needsInput}</span> : null}
        </button>
        <button className="tab settings icon" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
          <Settings size={17} aria-hidden="true" />
        </button>
      </nav>
    </div>
  );
}
