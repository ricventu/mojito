"use client";
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import AccessoryBar from "./AccessoryBar";
import { apiFetch } from "@/lib/client";
import { GATE_STATES } from "@/server/autoAdvance";
import type { SessionMeta } from "@/server/types";

export default function TerminalView(
  { token, session, onBack }: { token: string; session: SessionMeta; onBack: () => void },
) {
  const holder = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    const term = new Terminal({ fontSize: 13, convertEol: true });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(holder.current!);
    fit.fit();
    termRef.current = term;

    let closed = false;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws/pty?session=${encodeURIComponent(session.id)}&token=${encodeURIComponent(token)}`);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;
      ws.onopen = () => {
        fit.fit();
        ws.send(JSON.stringify({ resize: { cols: term.cols, rows: term.rows } }));
      };
      ws.onmessage = (m) => term.write(typeof m.data === "string" ? m.data : new Uint8Array(m.data));
      ws.onclose = () => { if (!closed) retry = setTimeout(connect, 1500); };
    };
    connect();

    const onData = term.onData((d) => wsRef.current?.send(new TextEncoder().encode(d)));
    const onResize = () => {
      fit.fit();
      wsRef.current?.send(JSON.stringify({ resize: { cols: term.cols, rows: term.rows } }));
    };
    window.addEventListener("resize", onResize);

    return () => {
      closed = true;
      clearTimeout(retry);
      onData.dispose();
      window.removeEventListener("resize", onResize);
      wsRef.current?.close();
      term.dispose();
    };
  }, [session.id, token]);

  const send = (bytes: string) => wsRef.current?.send(new TextEncoder().encode(bytes));
  const isGate = GATE_STATES.includes(session.launchStatus);
  const advance = async (arg: string) => {
    await apiFetch(token, `/api/sessions/${session.id}/advance`, { method: "POST", body: JSON.stringify({ arg }) });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <header style={{ padding: 12, borderBottom: "1px solid #222" }}>
        <button onClick={onBack}>‹</button> {session.ticket} · {session.launchStatus}
      </header>
      <div ref={holder} style={{ flex: 1, overflow: "hidden" }} />
      {isGate ? (
        <div style={{ display: "flex", gap: 8, padding: 8, borderTop: "1px solid #222" }}>
          {(session.launchStatus === "To QA" ? ["approve", "reject"] : ["local", "mr"]).map((a) => (
            <button key={a} onClick={() => advance(a)} style={{ flex: 1, padding: 12 }}>{a}</button>
          ))}
        </div>
      ) : (
        <AccessoryBar onSend={send} />
      )}
    </div>
  );
}
