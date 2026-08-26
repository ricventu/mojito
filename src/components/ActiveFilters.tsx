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
  { filters, onClear, onClearAll }:
  { filters: ActiveFilter[]; onClear: (filter: ActiveFilter) => void; onClearAll: () => void },
) {
  if (filters.length === 0) return null;
  return (
    <div className="active-filters">
      {/* A row of lime chips would otherwise read as another FilterBar row rather than
          as a warning that things are hidden. One word settles it. */}
      <span className="af-lead">Filtered</span>
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
      {/* With a single filter its own clear icon is already clear-all, so a second control
          would only be noise. Two selected projects do reach it, and should: each chip
          now drops only its own name (RIC-252), so dropping the lot needs this. */}
      {filters.length > 1 && (
        <button className="chip af-all" onClick={onClearAll}>Clear all</button>
      )}
    </div>
  );
}
