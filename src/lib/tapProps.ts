import type { KeyboardEvent } from "react";

/**
 * Props that make a `<div>` behave like a button: focusable, announced with the
 * `button` role, and activated by click, Enter or Space — the keyboard-activation
 * set a real `<button>` gets for free. Space's default (page scroll) is suppressed
 * so the region behaves exactly like a button would.
 *
 * TicketCard, SessionCard and SessionRow all use a `<div onClick>` for their tap
 * region rather than a real `<button>`, because each one has other interactive
 * elements (buttons) as siblings inside the same card/row — nesting those inside a
 * `<button>` would be invalid HTML. This restores the keyboard reachability a real
 * button gives without creating that nesting problem.
 */
export function tapProps(onActivate: () => void): {
  role: "button";
  tabIndex: 0;
  onClick: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
} {
  return {
    role: "button",
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e) => {
      if (e.key === "Enter") {
        onActivate();
      } else if (e.key === " ") {
        e.preventDefault();
        onActivate();
      }
    },
  };
}
