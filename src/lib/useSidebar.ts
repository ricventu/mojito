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
 * the sidebar costs the pty a resize and tmux a full repaint. That is only safe because
 * TerminalView is loaded `ssr: false` and so never renders on the server; do not lift
 * this hook into a component that does.
 */
export function useSidebar(keyboardOpen: boolean): Sidebar {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(initialPin);
  const [wide, setWide] = useState(() => window.matchMedia(SIDEBAR_DOCK_QUERY).matches);

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
