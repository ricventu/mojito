import { useEffect, useReducer, useState } from "react";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { isDocked, sidebarReducer, type SidebarModel } from "@/lib/sidebarState";

/** localStorage key of the sidebar's pin: a preference of this browser, shared by its tabs. */
export const SIDEBAR_PIN_KEY = "mojito-sidebar-pinned";
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
  /** Pinning the overlay docks it; unpinning a docked sidebar closes it. */
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

function initialModel(): SidebarModel {
  const pinned = readPinned();
  const canPin = typeof window !== "undefined" && window.matchMedia(SIDEBAR_DOCK_QUERY).matches;
  return { open: pinned && canPin, pinned };
}

/**
 * The live-session sidebar: storage and the media query around `sidebarReducer`. A pinned
 * sidebar starts open, read synchronously in the initialiser, so it docks on the first
 * render: the terminal's pty is not resized once for the bare page and again for the column.
 */
export function useSidebar(): SidebarState {
  const canPin = useMediaQuery(SIDEBAR_DOCK_QUERY);
  const [model, dispatch] = useReducer(sidebarReducer, undefined, initialModel);
  // Adjusted during render, not in an effect: a docked sidebar crossing the breakpoint must
  // not commit one frame as a modal overlay over the terminal before it closes.
  const [seenCanPin, setSeenCanPin] = useState(canPin);
  if (seenCanPin !== canPin) {
    setSeenCanPin(canPin);
    dispatch({ type: "canPinChanged", canPin });
  }

  useEffect(() => writePinned(model.pinned), [model.pinned]);

  return {
    open: model.open,
    docked: isDocked(model, canPin),
    canPin,
    pinned: model.pinned,
    toggle: () => dispatch({ type: "toggle", canPin }),
    close: () => dispatch({ type: "close", canPin }),
    setPinned: (pinned) => dispatch({ type: "setPinned", pinned, canPin }),
  };
}
