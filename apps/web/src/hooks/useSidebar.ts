import { useState } from "react";
import { useMediaQuery } from "@/hooks/useMediaQuery";

/** localStorage key of the sidebar's pin: a preference of this browser, shared by its tabs. */
export const SIDEBAR_PIN_KEY = "mojito2-sidebar-pinned";
/** Where a pinned sidebar docks; below it the pin is not offered and a remembered one is ignored. */
export const SIDEBAR_DOCK_QUERY = "(min-width: 1024px)";

export interface SidebarState {
  open: boolean;
  /** Open as a column beside the page rather than an overlay. */
  docked: boolean;
  canPin: boolean;
  pinned: boolean;
  /** A docked sidebar closes and unpins; otherwise it flips `open`. */
  toggle(): void;
  /** Closes; a docked sidebar is unpinned too, so a reload does not bring it back. */
  close(): void;
  /** Unpinning leaves the sidebar open, as an overlay. */
  setPinned(p: boolean): void;
}

function readPinned(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_PIN_KEY) === "1";
  } catch {
    return false;
  }
}

function writePinned(p: boolean): void {
  try {
    if (p) localStorage.setItem(SIDEBAR_PIN_KEY, "1");
    else localStorage.removeItem(SIDEBAR_PIN_KEY);
  } catch {
    // Not remembered: the pin lasts until this page goes away.
  }
}

/**
 * The live-session sidebar's open flag and pin. A pinned sidebar starts open, read
 * synchronously in the initialisers, so it docks on the first render: the terminal's
 * pty is not resized once for the bare page and again for the docked column.
 */
export function useSidebar(): SidebarState {
  const canPin = useMediaQuery(SIDEBAR_DOCK_QUERY);
  const [pinned, setPinnedState] = useState(readPinned);
  const [open, setOpen] = useState(
    () => pinned && typeof window !== "undefined" && window.matchMedia(SIDEBAR_DOCK_QUERY).matches,
  );
  const docked = open && pinned && canPin;

  const setPinned = (p: boolean) => {
    writePinned(p);
    setPinnedState(p);
  };
  const close = () => {
    setOpen(false);
    if (docked) setPinned(false);
  };
  const toggle = () => (docked ? close() : setOpen(!open));

  return { open, docked, canPin, pinned, toggle, close, setPinned };
}
