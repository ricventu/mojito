"use client";

export default function FilterBar(
  { query, onQuery, projects, active, onProject, statuses, activeStatus, onStatus,
    mine, onMine, sessionsOnly, onSessionsOnly, placeholder, action }:
  {
    query: string;
    onQuery: (q: string) => void;
    projects: string[];
    active: string | null;
    onProject: (p: string | null) => void;
    statuses?: string[];
    activeStatus?: string | null;
    onStatus?: (s: string | null) => void;
    mine?: boolean;
    onMine?: (v: boolean) => void;
    sessionsOnly?: boolean;
    onSessionsOnly?: (v: boolean) => void;
    placeholder?: string;
    action?: React.ReactNode;
  },
) {
  const hasStatuses = statuses != null && onStatus != null
    && (statuses.length > 0 || (activeStatus ?? null) !== null);
  return (
    <div className="filter">
      <div className="filter-top">
        <input
          className="search"
          type="search"
          inputMode="search"
          placeholder={placeholder ?? "Search…"}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
        />
      </div>
      {/* The actions get their own row: the unified list needs three of them, and
          .filter-top does not wrap — a third button there would squeeze the search
          field down to nothing on a phone. */}
      {action && <div className="filter-actions">{action}</div>}
      {(projects.length > 0 || active !== null) && (
        <div className="filter-chips">
          <button className={`chip toggle${active === null ? " on" : ""}`} onClick={() => onProject(null)}>All</button>
          {projects.map((p) => (
            <button key={p} className={`chip toggle${active === p ? " on" : ""}`} onClick={() => onProject(p)}>{p}</button>
          ))}
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
                <button
                  key={s}
                  className={`chip toggle${activeStatus === s ? " on" : ""}`}
                  onClick={() => onStatus!(s)}
                >
                  {s}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
