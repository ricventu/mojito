"use client";
import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import AccessoryBar from "./AccessoryBar";
import StateBadge from "./StateBadge";
import { apiFetch } from "@/lib/client";
import { GATE_STATES } from "@/server/autoAdvance";
import type { SessionMeta } from "@/server/types";

export default function TerminalView(
  { token, session, onBack }: { token: string; session: SessionMeta; onBack: () => void },
) {
  const holder = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const [advErr, setAdvErr] = useState<string | null>(null);
  const [auto, setAuto] = useState(session.autoAdvance);

  useEffect(() => {
    const term = new Terminal({
      fontSize: 13,
      convertEol: true,
      fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      theme: { background: "#08090a", foreground: "#c9d1d9", cursor: "#5ce08a" },
    });
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
    const res = await apiFetch(token, `/api/sessions/${session.id}/advance`, { method: "POST", body: JSON.stringify({ arg }) });
    if (res.ok) {
      setAdvErr(null);
      onBack();
    } else {
      let message = `advance failed (${res.status})`;
      try {
        const body = await res.json();
        if (body?.error) message = body.error;
      } catch {
        /* non-JSON error body */
      }
      setAdvErr(message);
    }
  };
  const toggleAuto = async () => {
    const nextValue = !auto;
    const res = await apiFetch(token, `/api/sessions/${session.id}`, { method: "PATCH", body: JSON.stringify({ autoAdvance: nextValue }) });
    if (res.ok) setAuto(nextValue);
  };
  const active = session.state === "running" || session.state === "needs-input" || session.state === "starting";
  const kill = async () => {
    const prompt = active
      ? `Kill the running session for ${session.ticket}?`
      : `Dismiss the session for ${session.ticket}?`;
    if (!confirm(prompt)) return;
    await apiFetch(token, `/api/sessions/${session.id}`, { method: "DELETE" });
    onBack();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <header className="term-head">
        <button className="back" onClick={onBack}>‹</button>
        <span className="id">{session.ticket}</span>
        <span className="status">· {session.launchStatus}</span>
        <span className="grow" />
        <button className={`chip toggle${auto ? " on" : ""}`} onClick={toggleAuto}>
          auto: {auto ? "on" : "off"}
        </button>
        <StateBadge state={session.state} />
        <button className={`btn sm${active ? " danger" : ""}`} onClick={kill}>
          {active ? "Kill" : "Dismiss"}
        </button>
      </header>
      {session.title && <div className="term-title">{session.title}</div>}
      <div ref={holder} style={{ flex: 1, overflow: "hidden" }} />
      {isGate ? (
        <div className="gate">
          {advErr && <div style={{ padding: "8px 12px", color: "var(--err)", fontSize: 12 }}>{advErr}</div>}
          <div className="btns">
            {(session.launchStatus === "To QA" ? ["approve", "reject"] : ["local", "mr"]).map((a) => (
              <button key={a} className={`btn${a === "reject" ? " danger" : " primary"}`} onClick={() => advance(a)}>{a}</button>
            ))}
          </div>
        </div>
      ) : (
        <AccessoryBar onSend={send} />
      )}
    </div>
  );
}
