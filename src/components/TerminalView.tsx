"use client";
import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import AccessoryBar from "./AccessoryBar";
import StateBadge from "./StateBadge";
import { apiFetch } from "@/lib/client";
import { computeTouchScroll, wheelSequences } from "@/lib/touchScroll";
import { SESSION_GONE_CODE } from "@/lib/ptyClose";
import { termRootStyle } from "@/lib/keyboardInset";
import { terminalTabTitle } from "@/lib/terminalTabTitle";
import type { SessionMeta } from "@/server/types";

export default function TerminalView(
  { token, session, onBack }: { token: string; session: SessionMeta; onBack: () => void },
) {
  const holder = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const [auto, setAuto] = useState(session.autoAdvance);

  useEffect(() => {
    // React StrictMode (dev) mounts this effect, runs its cleanup, and remounts
    // it — all synchronously within one macrotask. xterm's Viewport constructor
    // (invoked by term.open) schedules a bare `setTimeout(() => syncScrollArea())`
    // that is NOT cancelled on dispose; if we open a terminal and dispose it in
    // that same macrotask, the timer later fires on a disposed renderer and
    // throws "undefined is not an object (evaluating 'this._renderer.value.dimensions')".
    // Deferring the whole setup by a macrotask lets StrictMode's transient mount
    // cancel via `clearTimeout` before any terminal is opened, so only the
    // surviving mount ever creates one — and it is never disposed until a real
    // unmount, long after xterm's internal timer has safely run.
    let torn = false;
    let teardown: (() => void) | null = null;

    const start = () => {
      if (torn) return;
      const term = new Terminal({
        fontSize: 13,
        convertEol: true,
        fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
        theme: { background: "#08090a", foreground: "#c9d1d9", cursor: "#5ce08a" },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      // Make http(s) URLs in terminal output clickable; open in a new tab.
      term.loadAddon(
        new WebLinksAddon((event, uri) => {
          window.open(uri, "_blank", "noopener,noreferrer");
        }),
      );
      term.open(holder.current!);
      fit.fit();
      termRef.current = term;

      // Enter submits in claude's TUI; Shift+Enter must insert a newline instead.
      // xterm emits a bare CR for Enter regardless of Shift, so intercept the keydown
      // and send LF (0x0A, claude's `chat:newline`) ourselves, suppressing the CR.
      term.attachCustomKeyEventHandler((e) => {
        if (e.type === "keydown" && e.key === "Enter" && e.shiftKey) {
          wsRef.current?.send(new TextEncoder().encode("\n"));
          return false;
        }
        return true;
      });

      // Send the current terminal dimensions to the pty, but only once the socket
      // is OPEN — send() on a CONNECTING socket (at mount, or during the 1.5s
      // reconnect window) throws InvalidStateError. ws.onopen sends the initial
      // resize; the window and visual-viewport resize handlers route through here
      // too, so the OPEN guard lives in exactly one place.
      const sendResize = () => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ resize: { cols: term.cols, rows: term.rows } }));
        }
      };

      let closed = false;
      let retry: ReturnType<typeof setTimeout>;
      const connect = () => {
        const proto = location.protocol === "https:" ? "wss" : "ws";
        const ws = new WebSocket(`${proto}://${location.host}/ws/pty?session=${encodeURIComponent(session.id)}&token=${encodeURIComponent(token)}`);
        ws.binaryType = "arraybuffer";
        wsRef.current = ws;
        ws.onopen = () => {
          // The socket can finish connecting after teardown (any unmount can land
          // mid-connect). Fitting or writing to a disposed terminal hits xterm's
          // unguarded `dimensions` getter and throws, so bail on the same `closed`
          // flag `onclose` already checks.
          if (closed) return;
          fit.fit();
          sendResize();
        };
        ws.onmessage = (m) => {
          if (closed) return;
          term.write(typeof m.data === "string" ? m.data : new Uint8Array(m.data));
        };
        ws.onclose = (ev) => {
          if (closed) return;
          // The tmux session is gone for good (retired on auto-advance, killed, or
          // crashed). Reconnecting would just respawn a doomed `tmux attach` that
          // prints "can't find session" and exits — an endless loop. Stop here.
          if (ev.code === SESSION_GONE_CODE) {
            term.write("\r\n\x1b[90m— session ended —\x1b[0m\r\n");
            return;
          }
          retry = setTimeout(connect, 1500);
        };
      };
      connect();

      const onData = term.onData((d) => wsRef.current?.send(new TextEncoder().encode(d)));
      const onResize = () => {
        fit.fit();
        sendResize();
      };
      window.addEventListener("resize", onResize);

      // The mobile virtual keyboard shrinks only the visual viewport, so pin
      // `.term-root` to it (see keyboardInset.ts) and re-fit xterm to the reduced
      // height, keeping the active prompt line and the accessory bar above the
      // keyboard. `window resize` alone does not fire for a keyboard that only
      // resizes the visual viewport, so this listener is required.
      const vv = window.visualViewport;
      const applyViewport = () => {
        const root = rootRef.current;
        if (!root || !vv) return;
        const style = termRootStyle({ height: vv.height, offsetTop: vv.offsetTop });
        root.style.height = style.height;
        root.style.transform = style.transform;
        fit.fit();
        // At mount, applyViewport() runs synchronously while the socket is still
        // CONNECTING; sendResize() no-ops until it is OPEN (ws.onopen sends the
        // initial resize once connected).
        sendResize();
        term.scrollToBottom();
      };
      if (vv) {
        vv.addEventListener("resize", applyViewport);
        vv.addEventListener("scroll", applyViewport);
        applyViewport();
      }

      teardown = () => {
        closed = true;
        clearTimeout(retry);
        onData.dispose();
        window.removeEventListener("resize", onResize);
        if (vv) {
          vv.removeEventListener("resize", applyViewport);
          vv.removeEventListener("scroll", applyViewport);
        }
        wsRef.current?.close();
        term.dispose();
        termRef.current = null;
      };
    };

    const startTimer = setTimeout(start, 0);
    return () => {
      torn = true;
      clearTimeout(startTimer);
      teardown?.();
    };
  }, [session.id, token]);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prev = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyOverscroll: body.style.overscrollBehavior,
    };
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";
    return () => {
      html.style.overflow = prev.htmlOverflow;
      body.style.overflow = prev.bodyOverflow;
      body.style.overscrollBehavior = prev.bodyOverscroll;
    };
  }, []);

  // Reflect the open ticket in the browser tab title, then restore the previous
  // title when the terminal closes. Mirrors the overflow save/restore effect above.
  useEffect(() => {
    const prev = document.title;
    document.title = terminalTabTitle(session);
    return () => {
      document.title = prev;
    };
  }, [session.ticket, session.title]);

  // Mobile touch scroll. Claude's TUI runs in the alternate screen buffer, so
  // xterm has no scrollback to move — scrollLines() is a no-op. Instead forward
  // the drag to Claude as SGR mouse-wheel events (it enables mouse tracking and
  // scrolls its own transcript), exactly what a real trackpad wheel would send.
  // Capture-phase listeners with stopPropagation keep xterm's own handler and
  // the page pan from also firing.
  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    let lastY = 0;
    let acc = 0;
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      lastY = e.touches[0].clientY;
      acc = 0;
      e.stopPropagation();
    };
    const onMove = (e: TouchEvent) => {
      const term = termRef.current;
      if (!term || e.touches.length !== 1) return;
      const y = e.touches[0].clientY;
      acc += lastY - y;
      lastY = y;
      const rowHeightPx = term.rows > 0 ? el.clientHeight / term.rows : 0;
      const { lines, remainderPx } = computeTouchScroll(acc, rowHeightPx);
      // Only forward wheel events when the foreground app has mouse tracking on.
      // Otherwise (bare shell, a no-mouse pager, a plain prompt) the pty would
      // deliver the SGR bytes as literal keystrokes and corrupt the input line.
      // When off, leave `acc` untouched so the drag simply does nothing.
      if (lines !== 0 && term.modes.mouseTrackingMode !== "none") {
        const seq = wheelSequences(lines);
        if (seq) wsRef.current?.send(new TextEncoder().encode(seq));
        acc = remainderPx;
      }
      e.stopPropagation();
      e.preventDefault();
    };
    el.addEventListener("touchstart", onStart, { passive: true, capture: true });
    el.addEventListener("touchmove", onMove, { passive: false, capture: true });
    return () => {
      el.removeEventListener("touchstart", onStart, { capture: true } as EventListenerOptions);
      el.removeEventListener("touchmove", onMove, { capture: true } as EventListenerOptions);
    };
  }, []);

  const send = (bytes: string) => wsRef.current?.send(new TextEncoder().encode(bytes));
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
    <div className="term-root" ref={rootRef}>
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
      <AccessoryBar onSend={send} />
    </div>
  );
}
