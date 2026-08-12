"use client";
import type { ActiveFilter, FilterKey } from "@/lib/activeFilters";

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
  { filters, onClear, onClearAll }:
  { filters: ActiveFilter[]; onClear: (key: FilterKey) => void; onClearAll: () => void },
) {
  if (filters.length === 0) return null;
  return (
    <div className="active-filters">
      {/* A row of lime chips would otherwise read as another FilterBar row rather than
          as a warning that things are hidden. One word settles it. */}
      <span className="af-lead">Filtered</span>
      {filters.map((f) => (
        <button
          key={f.key}
          className="chip af-chip"
          // The label alone is not a usable name for a button whose job is removal.
          aria-label={`Remove filter ${f.label}`}
          onClick={() => onClear(f.key)}
        >
          <span className="af-text">{f.label}</span>
          <span className="af-x" aria-hidden="true">✕</span>
        </button>
      ))}
      {/* With a single filter its own ✕ is already clear-all, so a second control
          would only be noise. */}
      {filters.length > 1 && (
        <button className="chip af-all" onClick={onClearAll}>Clear all</button>
      )}
    </div>
  );
}
