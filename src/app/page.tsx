"use client";
import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import { useToken } from "@/lib/useToken";
import { useTickets } from "@/lib/useTickets";
import { useSessions } from "@/lib/useSessions";
import { useEvents } from "@/lib/useEvents";
import TokenGate from "@/components/TokenGate";
import TicketList from "@/components/TicketList";
import SessionList from "@/components/SessionList";
import AlertLayer from "@/components/AlertLayer";
import type { MojitoEvent } from "@/server/events";
import type { SessionMeta } from "@/server/types";

// xterm/xterm and its addons reference browser-only globals (e.g. `self`) at module
// load time, which crashes Next.js's server-side prerender of this page. Loading
// TerminalView with ssr:false keeps it out of the server bundle entirely.
const TerminalView = dynamic(() => import("@/components/TerminalView"), { ssr: false });

export default function Home() {
  const { token, setToken } = useToken();
  const [tab, setTab] = useState<"tickets" | "sessions">("tickets");
  const [open, setOpen] = useState<SessionMeta | null>(null);
  const [alerts, setAlerts] = useState<{ id: string; ticket: string; message: string }[]>([]);
  const { tickets, refresh: refreshTickets } = useTickets(token);
  const { sessions, refresh: refreshSessions } = useSessions(token);

  const onEvent = useCallback((e: MojitoEvent) => {
    refreshSessions();
    if (e.type === "session.alert") setAlerts((a) => [{ id: e.id, ticket: e.ticket, message: e.message }, ...a].slice(0, 20));
  }, [refreshSessions]);
  useEvents(token, onEvent);

  if (!token) return <TokenGate onSet={setToken} />;
  if (open) return <TerminalView token={token} session={open} onBack={() => setOpen(null)} />;

  const needsInput = sessions.filter((s) => s.state === "needs-input").length;

  return (
    <div style={{ paddingBottom: 64 }}>
      <AlertLayer alerts={alerts} onOpen={(id) => { const s = sessions.find((x) => x.id === id); if (s) setOpen(s); }} onClear={() => setAlerts([])} />
      {tab === "tickets"
        ? <TicketList token={token} tickets={tickets} sessions={sessions} onLaunched={() => { refreshSessions(); refreshTickets(); }} onOpen={setOpen} />
        : <SessionList token={token} sessions={sessions} onOpen={setOpen} onChanged={refreshSessions} />}
      <nav style={{ position: "fixed", bottom: 0, left: 0, right: 0, display: "flex", borderTop: "1px solid #222" }}>
        <button onClick={() => setTab("tickets")} style={{ flex: 1, padding: 16 }}>Tickets</button>
        <button onClick={() => setTab("sessions")} style={{ flex: 1, padding: 16 }}>
          Sessions{needsInput ? ` (${needsInput})` : ""}
        </button>
      </nav>
    </div>
  );
}
