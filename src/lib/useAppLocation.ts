"use client";
import { useCallback, useEffect, useState } from "react";
import { formatLocation, NO_FILTERS, parseLocation, type AppLocation } from "./appLocation";
import { FILTER_KEY, filtersToRemember, seedFilters } from "./filterMemory";
import { canGoBack, pushedState } from "./navDepth";

// What the first render assumes, before the effect below reads the real url. The
// server prerenders this page, so touching `window` in a state initializer would
// be a hydration mismatch; resolving it in an effect is invisible in practice
// because the token gate (also effect-resolved, see useToken) paints first.
const UNRESOLVED: AppLocation = { view: { kind: "list" }, filters: NO_FILTERS };

/**
 * Safari rate-limits pushState/replaceState (~100 calls per 30 seconds) and older
 * versions throw once the limit is hit. Typing in the filter box replaces the url on
 * every keystroke, so a refused write must never swallow the keystroke with it: the
 * React state below is updated either way, and the address bar catches up on the
 * next call that gets through.
 */
function writeHistory(write: () => void) {
  try {
    write();
  } catch {
    // Nothing to recover: the url is one navigation stale, the app is not.
  }
}

function fromWindow(): AppLocation {
  return parseLocation(window.location.pathname, window.location.search);
}

/**
 * Storage is best effort at both ends: Safari's private mode throws on setItem, and
 * a browser that refuses to remember filters must not take the board down with it.
 */
function readRemembered(): string | null {
  try {
    return localStorage.getItem(FILTER_KEY);
  } catch {
    return null;
  }
}

function remember(search: string): void {
  try {
    localStorage.setItem(FILTER_KEY, search);
  } catch {
    // Nothing to recover: this launch keeps its filters, the next one starts clean.
  }
}

/**
 * The address bar as the single source of truth for the client's view and filters.
 *
 * Every navigation is a history entry, so Back works, a reload lands where it left
 * off, and two browser tabs hold two independent states — none of which a
 * localStorage-backed state can do. All url logic lives in appLocation; this hook
 * is only the `window`/`history` glue around it.
 */
export function useAppLocation() {
  const [location, setLocation] = useState<AppLocation>(UNRESOLVED);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    const current = fromWindow();
    // A board opened with no filters of its own is seeded from the last set the user
    // left behind (RIC-272) — the PWA's start_url is a bare `/`, so without this every
    // launch of the installed app arrives unfiltered. seedFilters owns every refusal;
    // this only writes the url it answers, and writes it with replace rather than push
    // so Back does not walk into the bare url the seed just left.
    const seeded = seedFilters(current, readRemembered());
    const next = seeded === null ? current : { ...current, filters: seeded };
    if (seeded !== null) {
      writeHistory(() => window.history.replaceState(window.history.state, "", formatLocation(next)));
    }
    setLocation(next);
    setResolved(true);
    // Back, forward, and the mobile back gesture all arrive here.
    const onPop = () => setLocation(fromWindow());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Remember what the board is filtered on, for the next launch. Gated on the effect
  // above having run: the first render is UNRESOLVED, whose filters are the defaults,
  // and writing those would clear the very set the seed is about to read.
  useEffect(() => {
    if (!resolved) return;
    const search = filtersToRemember(location);
    if (search !== null) remember(search);
  }, [resolved, location]);

  /** Go somewhere new, adding a history entry. */
  const navigate = useCallback((next: AppLocation) => {
    const url = formatLocation(next);
    // Re-tapping the tab you are already on should not stack up entries that Back
    // then has to walk through one by one.
    if (url !== window.location.pathname + window.location.search) {
      writeHistory(() => window.history.pushState(pushedState(window.history.state), "", url));
    }
    setLocation(next);
  }, []);

  /** Correct where we already are — no history entry, so Back skips the bad url. */
  const replace = useCallback((next: AppLocation) => {
    writeHistory(() => window.history.replaceState(window.history.state, "", formatLocation(next)));
    setLocation(next);
  }, []);

  /**
   * An in-app back button. Steps back through history when the previous entry is
   * one of ours, and navigates to `fallback` when it is not — a link opened
   * straight into a terminal has nothing behind it, and backing out of that would
   * leave Mojito rather than return to the list.
   */
  const back = useCallback((fallback: AppLocation) => {
    if (canGoBack(window.history.state)) window.history.back();
    else navigate(fallback);
  }, [navigate]);

  return { location, navigate, replace, back };
}
