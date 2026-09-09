"use client";
import { BACKLOG_STATUS } from "@/lib/status";
import type { BacklogChip } from "@/lib/backlogFilter";

/** What the Backlog chip says it is doing, and what one more tap will do. */
const BACKLOG_LABEL: Record<BacklogChip, string> = {
  off: "Backlog hidden — show only Backlog",
  only: "Only Backlog — show Backlog with everything else",
  on: "Backlog shown — hide it",
};

/**
 * The board's toolbar: free-text search first, then project chips + actions, then the
 * status chips (RIC-226), and the saved-favourites row (RIC-306) last.
 */
export default function FilterBar(
  { query, onQuery, projects, active, onProject, statuses, activeStatus, onStatus,
    backlog, onBacklog, mine, onMine, placeholder, action,
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
    backlog?: BacklogChip;
    onBacklog?: () => void;
    mine?: boolean;
    onMine?: (v: boolean) => void;
    placeholder?: string;
    action?: React.ReactNode;
    favorites?: React.ReactNode;
  },
) {
  const hasStatuses = statuses != null && onStatus != null
    && (statuses.length > 0 || (activeStatus ?? null) !== null);
  const hasProjects = projects.length > 0 || active.length > 0;

  const allProjectsActive = active.length === 0 || (projects.length > 0 && active.length === projects.length);
  const toggleAllProjects = () => {
    onProject(allProjectsActive ? projects : []);
  };

  return (
    <div className="filter">
      {/* Search row: actions on the left, search fills the rest */}
      <div className="filter-search-row">
        {action}
        <input
          className="search"
          type="search"
          inputMode="search"
          placeholder={placeholder ?? "Search…"}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
        />
      </div>
      {hasProjects && (
        <div className="filter-actions">
          <div className="chip-row">
            <button
              className={`chip toggle${allProjectsActive ? " on" : ""}`}
              onClick={toggleAllProjects}
            >
              All
            </button>
            {projects.map((p) => (
              <button
                key={p}
                className={`chip toggle${active.includes(p) ? " on" : ""}`}
                onClick={() => {
                  const next = active.includes(p)
                    ? active.filter((v) => v !== p)
                    : [...active, p];
                  onProject(next);
                }}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      )}
      {(hasStatuses || onMine) && (
        <div className="filter-chips">
          {hasStatuses && (
            <>
              <button className={`chip toggle${(activeStatus ?? null) === null ? " on" : ""}`} onClick={() => onStatus!(null)}>All</button>
              {statuses!.map((s) => (
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
          {onMine && (
            <>
              <span className="chip-divider" aria-hidden="true" />
              <button
                className={`chip toggle${mine ? " on" : ""}`}
                aria-pressed={mine}
                onClick={() => onMine(!mine)}
              >
                Mine
              </button>
            </>
          )}
        </div>
      )}
      {favorites}
    </div>
  );
}
