import { useEffect, useLayoutEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { toast } from "sonner";
import { SESSION_GONE_CODE } from "@mojito/shared";
import { browserClipboard, copyText } from "@/lib/terminal/copySelection";
import { xtermThinksItIsNode } from "@/lib/terminal/platform";
import { syncGeometry } from "@/lib/terminal/terminalFit";
import { terminalOptions } from "@/lib/terminal/terminalOptions";
import { computeTouchScroll, wheelSequences } from "@/lib/terminal/touchScroll";
import { getToken } from "@/lib/token";

const RECONNECT_MS = 1500;
const encoder = new TextEncoder();

function ptyUrl(sessionId: string): string {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}/ws/pty/${encodeURIComponent(sessionId)}?token=${encodeURIComponent(getToken())}`;
}

interface Props {
  sessionId: string;
  /** Is the mobile keyboard up? (`useKeyboardOpen`) — the terminal keeps its rows while it is. */
  keyboardOpen: boolean;
  /** The tmux session is gone for good (close code `SESSION_GONE_CODE`); nothing is retried after it. */
  onExit(): void;
  /** The live `Terminal` once it exists, `null` when it is torn down (the keys, composer and copy overlay drive it). */
  onReady?(term: Terminal | null): void;
}

/**
 * The browser terminal: xterm (DOM renderer) attached to `/ws/pty/<id>`. Keystrokes go
 * out as binary frames, the geometry as `{resize:{cols,rows}}` — on every (re)connect
 * unconditionally and on every change of the box, through `syncGeometry` (RIC-258). Any
 * close but `SESSION_GONE_CODE` reconnects every 1.5s while mounted. The terminal is
 * anchored to the bottom of its box, so rows the keyboard costs come off the top and
 * claude's input line stays on screen.
 */
export function TerminalView({ sessionId, keyboardOpen, onExit, onReady }: Props) {
  const holder = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  // Read by the geometry pass, so it must be current within the commit that changed it —
  // before the ResizeObserver reports the box that commit produced.
  const kbdRef = useRef(keyboardOpen);
  const syncRef = useRef<() => void>(() => {});
  const onExitRef = useRef(onExit);
  const onReadyRef = useRef(onReady);
  useLayoutEffect(() => {
    kbdRef.current = keyboardOpen;
    onExitRef.current = onExit;
    onReadyRef.current = onReady;
  });

  useEffect(() => {
    // StrictMode mounts, tears down and remounts this effect in one macrotask. xterm's
    // Viewport (built by `term.open`) arms a `setTimeout` that `dispose` does not cancel,
    // and it throws when it fires on a disposed renderer — so the whole setup waits a
    // macrotask, and the transient mount cancels before any terminal exists.
    let torn = false;
    let teardown: (() => void) | null = null;

    const start = () => {
      if (torn || !holder.current) return;
      const el = holder.current;
      const term = new Terminal(terminalOptions());
      // Vite leaves xterm's platform detection alone (see platform.ts); this says so loudly
      // in dev if a dependency ever starts shimming `process` and breaks the Option key.
      if (import.meta.env.DEV && xtermThinksItIsNode()) {
        console.warn("xterm thinks it is running in node: Option-key composition is broken on a Mac");
      }
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(el);
      fit.fit();
      termRef.current = term;
      onReadyRef.current?.(term);

      // send() on a CONNECTING socket throws; every write goes through this guard.
      const sendBytes = (data: string) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(encoder.encode(data));
      };
      const sendResize = () => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ resize: { cols: term.cols, rows: term.rows } }));
        }
      };
      const sync = () => {
        syncGeometry({
          keyboardOpen: kbdRef.current,
          propose: () => fit.proposeDimensions(),
          refit: () => fit.fit(),
          send: sendResize,
        });
      };
      syncRef.current = sync;

      // Enter submits in claude's TUI; Shift+Enter must insert a newline. xterm sends a
      // bare CR either way, so Shift+Enter is intercepted and sent as LF (`chat:newline`).
      term.attachCustomKeyEventHandler((e) => {
        if (e.type === "keydown" && e.key === "Enter" && e.shiftKey) {
          sendBytes("\n");
          return false;
        }
        return true;
      });
      const onData = term.onData(sendBytes);

      // Copy-on-select: the next mouse move would clear the selection (copySelection.ts),
      // so a release that ended a selection copies it. On window, after xterm's own
      // document-level mouseup has finalized it.
      let selectionChanged = false;
      const onSelection = term.onSelectionChange(() => {
        selectionChanged = true;
      });
      const onMouseUp = () => {
        if (!selectionChanged) return;
        selectionChanged = false;
        const text = term.getSelection();
        if (!text) return;
        void copyText(text, browserClipboard()).then((ok) => {
          if (ok) toast("Copied", { duration: 1500 });
          else toast.error("Copy failed");
        });
      };
      window.addEventListener("mouseup", onMouseUp);

      let closed = false;
      let retry: ReturnType<typeof setTimeout> | undefined;
      const connect = () => {
        const ws = new WebSocket(ptyUrl(sessionId));
        ws.binaryType = "arraybuffer";
        wsRef.current = ws;
        // Unconditional: the server attaches at 80x24 and this is the only thing that
        // corrects it, keyboard up or not (RIC-258).
        ws.onopen = () => {
          if (!closed) sync();
        };
        ws.onmessage = (m) => {
          if (!closed) term.write(typeof m.data === "string" ? m.data : new Uint8Array(m.data as ArrayBuffer));
        };
        ws.onclose = (ev) => {
          if (closed) return;
          if (ev.code === SESSION_GONE_CODE) {
            onExitRef.current();
            return;
          }
          retry = setTimeout(connect, RECONNECT_MS);
        };
      };
      connect();

      // Every box change — window resize, the keyboard's band, the header coming and
      // going — lands here. The xterm element is absolutely positioned, so fitting it
      // never resizes the observed box back.
      const observer = new ResizeObserver(() => {
        sync();
        term.scrollToBottom();
      });
      observer.observe(el);

      teardown = () => {
        closed = true;
        clearTimeout(retry);
        observer.disconnect();
        onData.dispose();
        onSelection.dispose();
        window.removeEventListener("mouseup", onMouseUp);
        wsRef.current?.close();
        wsRef.current = null;
        syncRef.current = () => {};
        onReadyRef.current?.(null);
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
  }, [sessionId]);

  // The header unmounts while the keyboard is up; publish the geometry either way.
  useEffect(() => {
    syncRef.current();
    termRef.current?.scrollToBottom();
  }, [keyboardOpen]);

  // The terminal replaces the page: nothing behind it may pan or bounce.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prev = { html: html.style.overflow, body: body.style.overflow, overscroll: body.style.overscrollBehavior };
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";
    return () => {
      html.style.overflow = prev.html;
      body.style.overflow = prev.body;
      body.style.overscrollBehavior = prev.overscroll;
    };
  }, []);

  // Touch scroll. claude's TUI runs in the alternate buffer, which has no scrollback, so a
  // drag is forwarded as SGR mouse-wheel events — what a trackpad would send — and only
  // while the foreground app has mouse tracking on; otherwise the bytes would arrive as
  // keystrokes. Capture phase + stopPropagation keep xterm's handler and the page pan out.
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
      // The terminal, not its box: with the keyboard up the terminal is taller than the
      // box it is anchored in, and the box would overstate a row's height.
      const termHeight = term.element?.clientHeight ?? el.clientHeight;
      const rowHeightPx = term.rows > 0 ? termHeight / term.rows : 0;
      const { lines, remainderPx } = computeTouchScroll(acc, rowHeightPx);
      if (lines !== 0 && term.modes.mouseTrackingMode !== "none") {
        const seq = wheelSequences(lines);
        if (seq && wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(encoder.encode(seq));
        acc = remainderPx;
      }
      e.stopPropagation();
      e.preventDefault();
    };
    el.addEventListener("touchstart", onStart, { passive: true, capture: true });
    el.addEventListener("touchmove", onMove, { passive: false, capture: true });
    return () => {
      el.removeEventListener("touchstart", onStart, { capture: true });
      el.removeEventListener("touchmove", onMove, { capture: true });
    };
  }, []);

  return (
    <div
      ref={holder}
      className="relative min-h-0 flex-1 overflow-hidden bg-[#08090a] [&_.xterm]:absolute [&_.xterm]:inset-x-0 [&_.xterm]:bottom-0 [&_.xterm]:touch-none"
    />
  );
}
