"use client";
import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useToken } from "@/lib/useToken";
import { usePersistedState } from "@/lib/usePersistedState";
import { useTickets } from "@/lib/useTickets";
import { useSessions } from "@/lib/useSessions";
import { useEvents } from "@/lib/useEvents";
import { useSelfUpdate } from "@/lib/useSelfUpdate";
import TokenGate from "@/components/TokenGate";
import UnifiedList from "@/components/UnifiedList";
import StacksPanel from "@/components/StacksPanel";
import AlertLayer from "@/components/AlertLayer";
import SettingsSheet from "@/components/SettingsSheet";
import DocsView from "@/components/DocsView";
import { tabTitle } from "@/lib/tabTitle";
import type { MojitoEvent } from "@/server/events";
import type { SessionMeta } from "@/server/types";
import type { DocsTarget } from "@/lib/useDocs";

// xterm/xterm and its addons reference browser-only globals (e.g. `self`) at module
// load time, which crashes Next.js's server-side prerender of this page. Loading
// TerminalView with ssr:false keeps it out of the server bundle entirely.
const TerminalView = dynamic(() => import("@/components/TerminalView"), { ssr: false });

export default function Home() {
  const { token, setToken } = useToken();
  const [tab, setTab] = usePersistedState("mojito-tab", "tickets");
  const [open, setOpen] = useState<SessionMeta | null>(null);
  const [alerts, setAlerts] = useState<{ id: string; ticket: string; message: string }[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [docsFor, setDocsFor] = useState<{ target: DocsTarget; label: string } | null>(null);
  const { tickets, refresh: refreshTickets } = useTickets(token);
  const { sessions, refresh: refreshSessions } = useSessions(token);
  // Owned here — not by StacksPanel or SettingsSheet — so a deploy's health poll and
  // "Deploying…" state survive switching tabs or opening a terminal, both of which
  // unmount StacksPanel mid-deploy. Called unconditionally, above the token/terminal/docs
  // early returns below, per the rules of hooks; the hook itself no-ops until a token exists.
  const selfUpdate = useSelfUpdate(token);

  const onEvent = useCallback((e: MojitoEvent) => {
    refreshSessions();
    if (e.type === "session.alert") setAlerts((a) => [{ id: e.id, ticket: e.ticket, message: e.message }, ...a].slice(0, 20));
  }, [refreshSessions]);
  useEvents(token, onEvent);

  // Own the browser tab title on the client: the active tab when signed in, the
  // app name on the token gate. Skipped while a terminal is open — TerminalView
  // sets the ticket title and restores this one on close.
  useEffect(() => {
    if (open) return;
    document.title = token ? tabTitle(tab) : "Mojito";
  }, [tab, token, open]);

  if (!token) return <TokenGate onSet={setToken} />;
  // Refresh on leaving the terminal: dismiss/advance mutate server state, and a
  // dead session (tmux gone) emits no hook event to trigger a refresh on its own,
  // so without this its card would linger in the list after being deleted.
  if (open) return <TerminalView token={token} session={open} tickets={tickets} onBack={() => { setOpen(null); refreshSessions(); }} />;
  // The overlay opened from a list replaces the page, since there is no terminal to keep alive here.
  if (docsFor) {
    return (
      <DocsView token={token} target={docsFor.target} label={docsFor.label} onClose={() => setDocsFor(null)} />
    );
  }

  const needsInput = sessions.filter((s) => s.state === "needs-input").length;

  return (
    <div style={{ paddingBottom: 64 }}>
      <AlertLayer alerts={alerts} onOpen={(id) => { const s = sessions.find((x) => x.id === id); if (s) setOpen(s); }} onClear={() => setAlerts([])} />
      {settingsOpen && <SettingsSheet token={token} onClose={() => setSettingsOpen(false)} selfUpdate={selfUpdate} />}
      {tab === "stacks"
        ? <StacksPanel token={token} onOpenLogs={setOpen} selfUpdate={selfUpdate} />
        : <UnifiedList token={token} tickets={tickets} sessions={sessions}
            onLaunched={() => { refreshSessions(); refreshTickets(); }}
            onChanged={refreshSessions}
            onOpen={setOpen}
            onOpenTicketDocs={(t) => setDocsFor({ target: { ticket: t.identifier, project: t.project }, label: t.identifier })}
            onOpenSessionDocs={(s) => setDocsFor({ target: { session: s.id }, label: s.ticket || s.title })} />}
      {/* Anything that is not "stacks" is the unified list, so a browser still holding
          the removed "sessions" value in mojito-tab lands somewhere real. */}
      <nav className="nav">
        <button className={`tab${tab !== "stacks" ? " active" : ""}`} onClick={() => setTab("tickets")}>
          Tickets{needsInput ? <span className="count">{needsInput}</span> : null}
        </button>
        <button className={`tab${tab === "stacks" ? " active" : ""}`} onClick={() => setTab("stacks")}>Stacks</button>
        <button className="tab settings" aria-label="Settings" onClick={() => setSettingsOpen(true)}>⚙</button>
      </nav>
    </div>
  );
}
