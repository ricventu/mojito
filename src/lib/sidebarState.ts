/**
 * The rules behind the terminal's session sidebar (RIC-313): when it is on screen, when
 * it takes a column of its own, and what dismisses it.
 *
 * Four inputs, all of them things only the component can know, and one derived shape —
 * the usual pure ÷ glue split, so every rule below is testable in the node-only vitest
 * setup rather than only in a browser at a particular width.
 */

/** Where the pin is remembered. See `readPin` for why it is storage and not the url. */
export const SIDEBAR_PIN_KEY = "mojito-sidebar-pinned";

/**
 * Is there room for a column beside the terminal? A docked sidebar takes ~260px, which
 * on a phone is most of the screen — below this the sidebar can only ever float over
 * the terminal, and the pin (whose whole meaning is "stay docked") is not offered.
 */
export const SIDEBAR_DOCK_QUERY = "(min-width: 900px)";

export interface SidebarInputs {
  /** Does the viewport match SIDEBAR_DOCK_QUERY? */
  wide: boolean;
  /** The remembered pin — see SIDEBAR_PIN_KEY. */
  pinned: boolean;
  /** The transient "I opened the drawer" flag; never remembered. */
  open: boolean;
  /** Is the mobile virtual keyboard up? (see keyboardInset.ts) */
  keyboardOpen: boolean;
}

export interface SidebarView {
  visible: boolean;
  /** In flow, taking width off the terminal — which means the pty must be re-fitted. */
  docked: boolean;
  /** Floating over the terminal, behind a backdrop; costs the pty nothing. */
  overlay: boolean;
  /** Offer the pin control at all? */
  canPin: boolean;
  /** Do the backdrop and picking a session close it? */
  dismissable: boolean;
}

/**
 * Docked only when pinned, and an overlay every other time it is on screen.
 *
 * That asymmetry is deliberate. Docking changes the terminal's width, so the pty is
 * resized and tmux repaints claude's entire TUI — a price worth paying once, for a
 * sidebar you asked to keep, and not at all for a peek at the list. So the unpinned
 * sidebar floats: opening and shutting it leaves the terminal's geometry alone.
 *
 * The keyboard hides it outright, pinned or not, for the reason the header is unmounted
 * on the same signal: with the keyboard up the visible band is worth ~13 rows and the
 * screen it is taken out of is a phone's.
 */
export function sidebarView({ wide, pinned, open, keyboardOpen }: SidebarInputs): SidebarView {
  const docked = wide && pinned && !keyboardOpen;
  const overlay = !docked && open && !keyboardOpen;
  return { visible: docked || overlay, docked, overlay, canPin: wide, dismissable: !docked };
}

/**
 * The pin as it was last left, from whatever storage answered.
 *
 * Storage and not the url, unlike everything RIC-204 moved into the address bar: which
 * view is open and how the board is filtered are what a link *means* and belong in one
 * shared with someone else, where whether this browser keeps a column of sessions open
 * is a preference of this browser's. Anything unrecognised — never written, cleared,
 * written by a build that encoded it differently — reads as unpinned, so the failure
 * mode is a shut sidebar rather than one nobody asked for.
 */
export function readPin(stored: string | null): boolean {
  return stored === "1";
}

export function storedPin(pinned: boolean): string {
  return pinned ? "1" : "0";
}
