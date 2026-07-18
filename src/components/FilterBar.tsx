"use client";
import { statusColorClass } from "@/lib/status";
export { NO_PROJECT } from "@/lib/ticketFilter";

export default function FilterBar(
  { query, onQuery, projects, active, onProject, statuses, activeStatus, onStatus, placeholder, action }:
  {
    query: string;
    onQuery: (q: string) => void;
    projects: string[];
    active: string | null;
    onProject: (p: string | null) => void;
    statuses?: string[];
    activeStatus?: string | null;
    onStatus?: (s: string | null) => void;
    placeholder?: string;
    action?: React.ReactNode;
  },
) {
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
        {action}
      </div>
      {(projects.length > 1 || active !== null) && (
        <div className="filter-chips projects">
          <button className={`chip toggle${active === null ? " on" : ""}`} onClick={() => onProject(null)}>All</button>
          {projects.map((p) => (
            <button key={p} className={`chip toggle${active === p ? " on" : ""}`} onClick={() => onProject(p)}>{p}</button>
          ))}
        </div>
      )}
      {statuses && onStatus && (statuses.length > 1 || (activeStatus ?? null) !== null) && (
        <div className="filter-chips">
          <button className={`chip toggle all${(activeStatus ?? null) === null ? " on" : ""}`} onClick={() => onStatus(null)}>All</button>
          {statuses.map((s) => (
            <button
              key={s}
              className={`chip toggle ${statusColorClass(s)}${activeStatus === s ? " on" : ""}`}
              onClick={() => onStatus(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
