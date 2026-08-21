/**
 * A ticket id label — `RIC-242` — is the issue's name, so wherever Mojito shows one it
 * is also the way to open that issue on Linear (RIC-242). The url is never built here:
 * it rides on `TicketSummary.url` straight from Linear's API, because Mojito would
 * otherwise have to learn a workspace slug and keep it, and a guessed url is worse
 * than no link at all.
 *
 * This module is the pure half; `TicketLink` is the component that renders it. Same
 * split as `resolveInitialToken` ÷ `useToken`, and for the same reason: the vitest
 * setup here is node-only, with no DOM to render into.
 */

/**
 * The url to hang on a ticket id, or "" for "render it as plain text" — which is the
 * fallback for every ticket Mojito has no url for: a custom session's, one that has
 * left the open list (Done), or a cached list written before `url` existed.
 *
 * Only http(s) survives. The value ends up in an `href` the human taps, and a
 * `javascript:`/`data:` one would run in Mojito's own origin; a relative one would
 * resolve against Mojito rather than Linear. Neither can come out of Linear's API
 * today, and neither is worth the chance that some path into this — a stale sidecar,
 * a hand-edited state file — ever makes it one. Same guard as `absolute()` in
 * openInApp.ts, for the same class of reason.
 */
export function ticketLinkUrl(url?: string | null): string {
  const raw = (url ?? "").trim();
  return /^https?:\/\//i.test(raw) ? raw : "";
}

/**
 * identifier → issue url over the polled ticket list, for the places that show a
 * ticket id without holding the ticket itself — the loose SessionCard, whose session
 * carries only the identifier. Mirrors `liveStatuses` (src/lib/ticketFilter.ts), and
 * like it wants the *unscoped* list: a ticket the current filters hide is exactly the
 * one whose session ends up loose, and it still has a perfectly good url.
 *
 * A ticket with no usable url is left out rather than mapped to "", so `get` answers
 * `undefined` for both "no such ticket" and "nothing to link to" — one case for the
 * caller instead of two.
 */
export function ticketUrls(tickets: { identifier: string; url?: string }[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const t of tickets) {
    const url = ticketLinkUrl(t.url);
    if (url) map.set(t.identifier, url);
  }
  return map;
}
