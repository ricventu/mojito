"use client";
import { useCallback, useEffect, useState } from "react";
import {
  SIDEBAR_DOCK_QUERY, SIDEBAR_PIN_KEY, readPin, sidebarView, storedPin,
  type SidebarView,
} from "./sidebarState";

/** Read the remembered pin. Best effort: Safari's private mode throws on storage. */
function initialPin(): boolean {
  try {
    return readPin(window.localStorage.getItem(SIDEBAR_PIN_KEY));
  } catch {
    return false;
  }
}

/**
 * Is there room to dock right now? Guarded like `initialPin` above, and for a second
 * reason as well as private mode: this hook is called from the board, which Next
 * prerenders, and a bare `window` there is a ReferenceError that would take the whole
 * page's render with it. The effect below corrects the answer on mount either way.
 */
function initialWide(): boolean {
  try {
    return window.matchMedia(SIDEBAR_DOCK_QUERY).matches;
  } catch {
    return false;
  }
}

export interface Sidebar {
  view: SidebarView;
  pinned: boolean;
  /** Show it, or hide it — the pin goes with it, since docking is what the pin means. */
  toggle: () => void;
  /** Dismiss it, if anything is allowed to (see SidebarView.dismissable). */
  dismiss: () => void;
  /** Pin it open, or let it go back to being a peek. */
  togglePin: () => void;
}

/**
 * The glue half of sidebarState.ts: storage, `matchMedia`, and the transient open flag.
 * Every actual rule is in the pure module — this only feeds it what the browser knows.
 *
 * Both initial values are read in `useState` initialisers rather than in a mount effect,
 * which would render one frame unpinned and then re-render — and a re-render that docks
 * the sidebar costs the pty a resize and tmux a full repaint.
 *
 * Both reads are therefore guarded rather than deferred, because the board calls this
 * hook too and the board is server-prerendered (TerminalView, loaded `ssr: false`, is
 * not). Nothing of the sidebar reaches that prerender to mismatch against: the app's
 * first client render is the token gate, since the token itself resolves in an effect —
 * see useToken and useAppLocation, which rests on the same fact.
 *
 * One call per host, and never two at once: page.tsx returns the terminal (or a doc)
 * *instead of* the board, so the hook that owns the sidebar is unmounted whenever the
 * other view's is mounted. That is what makes the remembered pin carry across a
 * navigation — each mount reads storage fresh — where two simultaneous copies would
 * leave the one nobody was toggling holding a stale value.
 */
export function useSidebar(keyboardOpen: boolean): Sidebar {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(initialPin);
  const [wide, setWide] = useState(initialWide);

  useEffect(() => {
    const mq = window.matchMedia(SIDEBAR_DOCK_QUERY);
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const pin = useCallback((next: boolean) => {
    setPinned(next);
    try {
      window.localStorage.setItem(SIDEBAR_PIN_KEY, storedPin(next));
    } catch {
      /* a browser that refuses to remember the pin must not take the terminal down */
    }
  }, []);

  const view = sidebarView({ wide, pinned, open, keyboardOpen });

  return {
    view,
    pinned,
    // One control, one meaning: is the sidebar on screen? Collapsing a docked one drops
    // the pin as well, because leaving it set would simply re-dock the sidebar the next
    // time it was opened — which is not what "close it" can be taken to mean.
    toggle: useCallback(() => {
      if (view.visible) {
        setOpen(false);
        if (view.docked) pin(false);
      } else {
        setOpen(true);
      }
    }, [view.visible, view.docked, pin]),
    dismiss: useCallback(() => {
      if (view.dismissable) setOpen(false);
    }, [view.dismissable]),
    // Unpinning leaves the sidebar on screen as an overlay rather than yanking it away:
    // the pin says how it is shown, not whether.
    togglePin: useCallback(() => {
      pin(!pinned);
      setOpen(true);
    }, [pin, pinned]),
  };
}
