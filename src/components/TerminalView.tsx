"use client";
import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import AccessoryBar from "./AccessoryBar";
import DocsView from "./DocsView";
import StateBadge from "./StateBadge";
import { apiFetch } from "@/lib/client";
import { computeTouchScroll, wheelSequences } from "@/lib/touchScroll";
import { SESSION_GONE_CODE } from "@/lib/ptyClose";
import { termRootStyle, isKeyboardOpen } from "@/lib/keyboardInset";
import { terminalOptions } from "@/lib/terminalOptions";
import { urlLinkProvider } from "@/lib/terminalLinkProvider";
import { isUsableGeometry } from "@/lib/terminalFit";
import { keepSettling } from "@/lib/viewportSettle";
import { terminalTabTitle } from "@/lib/terminalTabTitle";
import { readAsDataUrl } from "@/lib/readAsDataUrl";
import { quoteArg } from "@/lib/quoteArg";
import type { SessionMeta } from "@/server/types";

export default function TerminalView(
  { token, session, onBack }: { token: string; session: SessionMeta; onBack: () => void },
) {
  const holder = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const [auto, setAuto] = useState(session.autoAdvance);
  const [imgErr, setImgErr] = useState<string | null>(null);
  const [docsOpen, setDocsOpen] = useState(false);
  // While the keyboard is up the visible band is worth ~13 rows; the header and
  // the ticket title cost 8 of them, which is what leaves claude's TUI without
  // room for its input line (see keyboardInset.ts). Hide them until it closes.
  const [kbdOpen, setKbdOpen] = useState(false);
  const kbdOpenRef = useRef(false);
  // Set by the mount effect so the re-fit below can reach into its closure.
  const refitRef = useRef<() => void>(() => {});

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
      const term = new Terminal(terminalOptions());
      const fit = new FitAddon();
      term.loadAddon(fit);
      // Make http(s) URLs in terminal output clickable; open in a new tab. Our
      // own provider rather than WebLinksAddon, which linkifies only the first
      // row of a URL wider than the terminal here — see terminalLinks.ts.
      const links = term.registerLinkProvider(
        urlLinkProvider(term, (event, uri) => {
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

      // The mobile virtual keyboard shrinks only the visual viewport, so the
      // terminal is sized against that band rather than the layout viewport.
      // `window resize` alone does not fire for it, hence the vv listeners below.
      const vv = window.visualViewport;

      // Fit, but never to a geometry the mobile keyboard is only passing through
      // on its way to the final one (see terminalFit.ts — a mid-animation band
      // proposes 1 row, which would resize the tmux window to a single row and
      // take the TUI's input line with it).
      const applyFit = () => {
        // While the keyboard is up, leave the geometry alone entirely. The
        // terminal keeps the rows it had and `.term-body` shows the bottom of
        // them (see globals.css), so the input line stays on screen without the
        // pty — and claude's whole layout — having to be resized against a band
        // we cannot measure reliably. Also means no TUI reflow while typing.
        if (kbdOpenRef.current) return;
        if (!isUsableGeometry(fit.proposeDimensions())) return;
        fit.fit();
        sendResize();
      };

      // Pin `.term-root` to the visible band (see keyboardInset.ts). Re-read on
      // every pass: the band is what the terminal is measured against, and a
      // value caught mid-animation is what left the pty taller than the screen.
      const syncViewport = () => {
        const root = rootRef.current;
        if (!root || !vv) return;
        const style = termRootStyle({ height: vv.height, offsetTop: vv.offsetTop });
        root.style.height = style.height;
        root.style.transform = style.transform;
        const open = isKeyboardOpen({ layoutHeight: window.innerHeight, visualHeight: vv.height });
        // The ref is what applyFit reads: it must be current within this same
        // pass, before React has re-rendered on the state change.
        kbdOpenRef.current = open;
        setKbdOpen(open);
      };

      // Keep re-reading the band until it stops moving: iOS gives no guarantee
      // that a further event will arrive to correct the last one it sent.
      let settle: ReturnType<typeof setTimeout>;
      let lastBand = -1;
      let passes = 0;
      const settlePass = () => {
        const band = vv ? Math.round(vv.height) : window.innerHeight;
        syncViewport();
        applyFit();
        if (keepSettling({ band, lastBand, passes })) {
          lastBand = band;
          passes += 1;
          clearTimeout(settle);
          settle = setTimeout(settlePass, 250);
        }
      };
      const fitWhenSettled = () => {
        lastBand = -1;
        passes = 0;
        clearTimeout(settle);
        settlePass();
      };
      refitRef.current = fitWhenSettled;

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
          // Re-fit on (re)connect: this is also what recovers the pty's geometry
          // after a reconnect, since the server spawns the attach at its own
          // defaults until the first resize arrives.
          fitWhenSettled();
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
      const onResize = () => fitWhenSettled();
      window.addEventListener("resize", onResize);

      // Each viewport change starts a fresh settle run (sync the band, fit, then
      // keep checking until it stops moving). At mount this runs while the socket
      // is still CONNECTING; sendResize() no-ops until it is OPEN, and ws.onopen
      // starts its own run once connected.
      const applyViewport = () => {
        fitWhenSettled();
        term.scrollToBottom();
      };
      if (vv) {
        vv.addEventListener("resize", applyViewport);
        vv.addEventListener("scroll", applyViewport);
      }
      applyViewport();

      teardown = () => {
        closed = true;
        clearTimeout(retry);
        clearTimeout(settle);
        onData.dispose();
        links.dispose();
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

  // Showing or hiding the chrome changes the terminal's box, so re-fit once React
  // has committed the new layout — the pty must learn about the rows we just
  // handed back to it.
  useEffect(() => {
    refitRef.current();
  }, [kbdOpen]);

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

  // Auto-dismiss the transient image-attach error.
  useEffect(() => {
    if (!imgErr) return;
    const t = setTimeout(() => setImgErr(null), 6000);
    return () => clearTimeout(t);
  }, [imgErr]);

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
      // Measure against the terminal, not its container: with the keyboard open
      // the terminal is taller than the box it is anchored in (globals.css), so
      // the container's height would overstate how far one row is.
      const termHeight = term.element?.clientHeight ?? el.clientHeight;
      const rowHeightPx = term.rows > 0 ? termHeight / term.rows : 0;
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
  const pickImages = async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (!images.length) return;
    setImgErr(null);
    try {
      const payload = await Promise.all(images.map(async (f) => ({
        name: f.name || "image", type: f.type, dataUrl: await readAsDataUrl(f),
      })));
      const res = await apiFetch(token, `/api/sessions/${session.id}/paste-image`, {
        method: "POST", body: JSON.stringify({ images: payload }),
      });
      if (!res.ok) {
        let msg = "image upload failed";
        try { msg = (await res.json()).error ?? msg; } catch { /* keep default */ }
        setImgErr(msg);
        return;
      }
      const { paths } = (await res.json()) as { paths: string[] };
      if (paths.length) termRef.current?.paste(paths.map(quoteArg).join(" ") + " ");
    } catch {
      setImgErr("image upload failed");
    }
  };
  const toggleAuto = async () => {
    const nextValue = !auto;
    const res = await apiFetch(token, `/api/sessions/${session.id}`, { method: "PATCH", body: JSON.stringify({ autoAdvance: nextValue }) });
    if (res.ok) setAuto(nextValue);
  };
  const active = session.state === "running" || session.state === "needs-input" || session.state === "starting" || session.state === "idle";
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
      {!kbdOpen && (
      <header className="term-head">
        <button className="back" onClick={onBack}>‹</button>
        <span className="id">{session.ticket}</span>
        <span className="status">· {session.launchStatus}</span>
        <span className="grow" />
        <button className="btn sm" aria-label="Documents" onClick={() => setDocsOpen(true)}>📄</button>
        <button className={`chip toggle${auto ? " on" : ""}`} onClick={toggleAuto}>
          auto: {auto ? "on" : "off"}
        </button>
        <StateBadge state={session.state} />
        <button className={`btn sm${active ? " danger" : ""}`} onClick={kill}>
          {active ? "Kill" : "Dismiss"}
        </button>
      </header>
      )}
      {session.title && !kbdOpen && <div className="term-title">{session.title}</div>}
      <div ref={holder} className="term-body" />
      {imgErr && <div className="term-img-err err-text">{imgErr}</div>}
      <AccessoryBar onSend={send} onPasteText={(t) => termRef.current?.paste(t)} onPickImages={pickImages} />
      {docsOpen && (
        <DocsView
          token={token}
          target={{ session: session.id }}
          label={session.ticket || session.title}
          onClose={() => setDocsOpen(false)}
        />
      )}
    </div>
  );
}
