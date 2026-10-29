/** The sidebar's own state. Whether it can dock (the breakpoint) is the viewport's, passed in. */
export interface SidebarModel {
  open: boolean;
  pinned: boolean;
}

export type SidebarAction =
  | { type: "toggle"; canPin: boolean }
  | { type: "close"; canPin: boolean }
  | { type: "setPinned"; pinned: boolean; canPin: boolean }
  | { type: "canPinChanged"; canPin: boolean };

/** Docked: open as a column beside the page. Below the breakpoint a pin is remembered but ignored. */
export const isDocked = (m: SidebarModel, canPin: boolean): boolean => m.open && m.pinned && canPin;

const CLOSED: SidebarModel = { open: false, pinned: false };

/**
 * Leaving a docked sidebar, by toggle, ✕ or unpin, closes it and drops the pin, so one tap
 * never re-fits the pty wider and opens an overlay over it, and a reload does not bring it
 * back. The overlay only opens and closes; pinning it docks it. Crossing the breakpoint
 * moves a pinned sidebar between docked and closed, never into a modal overlay.
 */
export function sidebarReducer(m: SidebarModel, a: SidebarAction): SidebarModel {
  switch (a.type) {
    case "toggle":
      return isDocked(m, a.canPin) ? CLOSED : { ...m, open: !m.open };
    case "close":
      return isDocked(m, a.canPin) ? CLOSED : { ...m, open: false };
    case "setPinned":
      return !a.pinned && isDocked(m, a.canPin) ? CLOSED : { ...m, pinned: a.pinned };
    case "canPinChanged":
      return m.pinned ? { ...m, open: a.canPin } : m;
  }
}
