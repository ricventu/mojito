"use client";
import { X } from "lucide-react";
import type { ActiveFilter } from "@/lib/activeFilters";

/**
 * The sticky report of what is narrowing the list.
 *
 * It exists because FilterBar scrolls away: with it off screen a filtered list is
 * indistinguishable from a complete one, and the "No matching tickets or sessions."
 * hint only fires when *nothing* matches — never in the case that bites, where the
 * ticket you searched for is right there and the session you just launched is not.
 *
 * Renders nothing when nothing is filtered, so that condition lives here instead of
 * spread across UnifiedList.
 */
export default function ActiveFilters(
  { filters, onClear, onClearAll, action }:
  {
    filters: ActiveFilter[];
    onClear: (filter: ActiveFilter) => void;
    onClearAll: () => void;
    /**
     * Pinned to the right-hand end of the row — the "save these filters" star and its
     * naming field (RIC-306). It belongs here because this bar is the report of the
     * very filters it saves, and because this is the one row of the toolbar that never
     * scrolls away.
     */
    action?: React.ReactNode;
  },
) {
  // The action alone is reason enough to render. That is not a corner case: a board
  // whose only deviation from the defaults is *showing* the Backlog (RIC-275) reports
  // no chip at all — deliberately, see activeFilters — and is still a set worth
  // naming, so without this the star would be unreachable in exactly that state.
  if (filters.length === 0 && !action) return null;
  return (
    <div className="active-filters">
      {/* The chips scroll inside their own box, with the action as a sibling outside it
          (RIC-306). The alternative — one scrolling row with the action pinned over it,
          `position: sticky; right: 0` — is what this replaced: it needs a background
          gutter to stop a chip painting under the action, it puts a sticky element
          inside a sticky element that is also the scroll container, and none of that is
          testable off a real phone. Here the action is simply the last item of a row
          that does not scroll, so it cannot be reached by a chip or scrolled away
          from. */}
      <div className="af-scroll">
        {/* A row of lime chips would otherwise read as another FilterBar row rather than
            as a warning that things are hidden. One word settles it — and only when
            there are chips: with none, nothing is being hidden and the word would be a
            lie. */}
        {filters.length > 0 && <span className="af-lead">Filtered</span>}
        {/* Keyed on the value too: `project` reports one entry per selected project
            (RIC-252), so the key alone is no longer unique across the row. */}
        {filters.map((f) => (
          <button
            key={`${f.key}:${f.value ?? ""}`}
            className="chip af-chip"
            // The label alone is not a usable name for a button whose job is removal.
            aria-label={`Remove filter ${f.label}`}
            onClick={() => onClear(f)}
          >
            <span className="af-text">{f.label}</span>
            <X className="af-x" size={13} aria-hidden="true" />
          </button>
        ))}
        {/* With a single filter its own clear icon is already clear-all, so a second
            control would only be noise. Two selected projects do reach it, and should:
            each chip now drops only its own name (RIC-252), so dropping the lot needs
            this. */}
        {filters.length > 1 && (
          <button className="chip af-all" onClick={onClearAll}>Clear all</button>
        )}
      </div>
      {action}
    </div>
  );
}
