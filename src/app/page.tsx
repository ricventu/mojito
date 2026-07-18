"use client";
import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useToken } from "@/lib/useToken";
import { usePersistedState } from "@/lib/usePersistedState";
import { useTickets } from "@/lib/useTickets";
import { useSessions } from "@/lib/useSessions";
import { useEvents } from "@/lib/useEvents";
import TokenGate from "@/components/TokenGate";
import TicketList from "@/components/TicketList";
import SessionList from "@/components/SessionList";
import AlertLayer from "@/components/AlertLayer";
import { tabTitle } from "@/lib/tabTitle";
import type { MojitoEvent } from "@/server/events";
import type { SessionMeta } from "@/server/types";

// xterm/xterm and its addons reference browser-only globals (e.g. `self`) at module
// load time, which crashes Next.js's server-side prerender of this page. Loading
// TerminalView with ssr:false keeps it out of the server bundle entirely.
const TerminalView = dynamic(() => import("@/components/TerminalView"), { ssr: false });

export default function Home() {
  const { token, setToken } = useToken();
  const [tab, setTab] = usePersistedState("mojito-tab", "tickets");
  const [open, setOpen] = useState<SessionMeta | null>(null);
  const [alerts, setAlerts] = useState<{ id: string; ticket: string; message: string }[]>([]);
  const { tickets, refresh: refreshTickets } = useTickets(token);
  const { sessions, refresh: refreshSessions } = useSessions(token);

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
  if (open) return <TerminalView token={token} session={open} onBack={() => { setOpen(null); refreshSessions(); }} />;

  const needsInput = sessions.filter((s) => s.state === "needs-input").length;

  return (
    <div style={{ paddingBottom: 64 }}>
      <AlertLayer alerts={alerts} onOpen={(id) => { const s = sessions.find((x) => x.id === id); if (s) setOpen(s); }} onClear={() => setAlerts([])} />
      {tab === "tickets"
        ? <TicketList token={token} tickets={tickets} sessions={sessions} onLaunched={() => { refreshSessions(); refreshTickets(); }} onOpen={setOpen} />
        : <SessionList token={token} sessions={sessions} onOpen={setOpen} onChanged={refreshSessions} />}
      <nav className="nav">
        <button className={`tab${tab === "tickets" ? " active" : ""}`} onClick={() => setTab("tickets")}>Tickets</button>
        <button className={`tab${tab === "sessions" ? " active" : ""}`} onClick={() => setTab("sessions")}>
          Sessions{needsInput ? <span className="count">{needsInput}</span> : null}
        </button>
      </nav>
    </div>
  );
}
