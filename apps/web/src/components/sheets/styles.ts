/** A bottom sheet on a phone: rounded top, scrolls inside, pays the home-indicator inset itself. */
export const BOTTOM_SHEET_CLASS = "max-h-[92dvh] overflow-y-auto rounded-t-xl pb-[max(1rem,var(--sab))]";

/**
 * From `sm` up, turns a `side="bottom"` SheetContent into a dialog centred over the page's
 * column: beside a docked sidebar, not under it (`--dock-width`, index.css), and never wider
 * than what the sidebar leaves. It rises a little and fades instead of sliding up the screen.
 * Pure CSS, so a resize never remounts an open modal. The width cap (`sm:max-w-*`) and the
 * height are the caller's.
 */
export const CENTRED_ON_WIDE_CLASS = [
  "sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-[calc(var(--dock-width)+(100%-var(--dock-width))/2)]",
  "sm:w-[calc(100%-var(--dock-width)-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:border",
  "sm:data-[state=open]:slide-in-from-bottom-2 sm:data-[state=open]:fade-in-0 sm:data-[state=open]:zoom-in-95 sm:data-[state=open]:duration-200",
  "sm:data-[state=closed]:slide-out-to-bottom-2 sm:data-[state=closed]:fade-out-0 sm:data-[state=closed]:zoom-out-95 sm:data-[state=closed]:duration-150",
].join(" ");

/** The board's modals: a bottom sheet on a phone, a centred dialog wider up. */
export const SHEET_CONTENT_CLASS = `${BOTTOM_SHEET_CLASS} ${CENTRED_ON_WIDE_CLASS} sm:max-h-[85dvh] sm:max-w-lg`;
