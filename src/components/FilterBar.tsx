"use client";
import { MultiCombobox } from "./ui/combobox";
import { BACKLOG_STATUS } from "@/lib/status";
import type { BacklogChip } from "@/lib/backlogFilter";

/** What the Backlog chip says it is doing, and what one more tap will do. */
const BACKLOG_LABEL: Record<BacklogChip, string> = {
  off: "Backlog hidden — show only Backlog",
  only: "Only Backlog — show Backlog with everything else",
  on: "Backlog shown — hide it",
};

/**
 * The board's toolbar: the saved-favourites row (RIC-306), then project select +
 * actions, then the status chips, then the text field (RIC-226).
 *
 * That order is deliberate. The search box used to lead, which put the control of last
 * resort — a typed query, once project and status are each one tap away — where the eye
 * lands first, and pushed the three actions and the project select down below it. Now
 * the row that *changes what the board shows* leads, the two narrowing axes follow in
 * the order of how coarse they are, and the free-text field closes the group; the
 * sticky active-filter badges (rendered after this by the list) read as the summary of
 * everything above them.
 */
export default function FilterBar(
  { query, onQuery, projects, active, onProject, statuses, activeStatus, onStatus,
    backlog, onBacklog, mine, onMine, sessionsOnly, onSessionsOnly, placeholder, action,
    favorites }:
  {
    query: string;
    onQuery: (q: string) => void;
    projects: string[];
    active: string[];
    onProject: (p: string[]) => void;
    statuses?: string[];
    activeStatus?: string | null;
    onStatus?: (s: string | null) => void;
    /**
     * The Backlog chip's tri-state (RIC-275). Given together with `onBacklog`, the
     * Backlog entry in `statuses` renders and cycles as three states instead of two;
     * without them it is an ordinary status chip, which is what every other caller of
     * this bar gets.
     */
    backlog?: BacklogChip;
    onBacklog?: () => void;
    mine?: boolean;
    onMine?: (v: boolean) => void;
    sessionsOnly?: boolean;
    onSessionsOnly?: (v: boolean) => void;
    placeholder?: string;
    action?: React.ReactNode;
    /**
     * The saved-favourites row (RIC-306), rendered above everything else. A slot like
     * `action` rather than props of its own: this bar stays presentational, and the
     * favourites carry their own server state and their own edit modes.
     */
    favorites?: React.ReactNode;
  },
) {
  const hasStatuses = statuses != null && onStatus != null
    && (statuses.length > 0 || (activeStatus ?? null) !== null);
  // Rendered whenever a project can be picked, even with no options yet on screen: an
  // active selection has to stay removable.
  const hasProjects = projects.length > 0 || active.length > 0;
  return (
    <div className="filter">
      {/* Leads the toolbar: one tap for a whole filter set is the coarsest thing here,
          and RIC-226's order is coarsest-first. */}
      {favorites}
      {(hasProjects || action) && (
        <div className="filter-actions">
          {/* A select, not a chip row (RIC-225): the options are now every configured
              project rather than only the ones with an open ticket, which is more names
              than a horizontally scrolling row can show — and it takes several at once,
              which chips cannot express at all. Statuses stay chips: there are five of
              them and they never grow. */}
          {hasProjects && (
            <div className="filter-select">
              <MultiCombobox
                options={projects.map((p) => ({ value: p, label: p }))}
                values={active}
                onChange={onProject}
                label="Filter by project"
                emptyState="All projects"
                searchLabel="Search projects…"
                emptyLabel="No project matches."
                clearLabel="Show all projects"
              />
            </div>
          )}
          {action}
        </div>
      )}
      {(hasStatuses || onMine || onSessionsOnly) && (
        <div className="filter-chips">
          {/* .filter-chips scrolls horizontally, so a trailing toggle would sit
              off-screen on a phone once the statuses fill the width. "lead" carries
              the gap and sits on Sessions, the scope toggle adjacent to the status
              chips — Mine always sits before it, so it needs no gap of its own. */}
          {onMine && (
            <button
              className={`chip toggle${mine ? " on" : ""}`}
              aria-pressed={mine}
              onClick={() => onMine(!mine)}
            >
              Mine
            </button>
          )}
          {onSessionsOnly && (
            <button
              className={`chip toggle lead${sessionsOnly ? " on" : ""}`}
              aria-pressed={sessionsOnly}
              onClick={() => onSessionsOnly(!sessionsOnly)}
            >
              Sessions
            </button>
          )}
          {hasStatuses && (
            <>
              <button className={`chip toggle${(activeStatus ?? null) === null ? " on" : ""}`} onClick={() => onStatus!(null)}>All</button>
              {statuses!.map((s) => (
                // The Backlog chip carries a third state — excluded — because the board
                // hides that bucket by default; every other status is on or off. Its
                // state cannot ride on aria-pressed, which holds two values, so the
                // label spells out where it is and what the next tap does.
                s === BACKLOG_STATUS && backlog != null && onBacklog ? (
                  <button
                    key={s}
                    className={`chip toggle${backlog === "only" ? " on" : ""}${backlog === "off" ? " off" : ""}`}
                    aria-label={BACKLOG_LABEL[backlog]}
                    title={BACKLOG_LABEL[backlog]}
                    onClick={onBacklog}
                  >
                    {s}
                  </button>
                ) : (
                  <button
                    key={s}
                    className={`chip toggle${activeStatus === s ? " on" : ""}`}
                    onClick={() => onStatus!(s)}
                  >
                    {s}
                  </button>
                )
              ))}
            </>
          )}
        </div>
      )}
      <input
        className="search"
        type="search"
        inputMode="search"
        placeholder={placeholder ?? "Search…"}
        value={query}
        onChange={(e) => onQuery(e.target.value)}
      />
    </div>
  );
}
