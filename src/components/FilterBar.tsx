"use client";

export const NO_PROJECT = "No project";

export default function FilterBar(
  { query, onQuery, projects, active, onProject, placeholder, action }:
  {
    query: string;
    onQuery: (q: string) => void;
    projects: string[];
    active: string | null;
    onProject: (p: string | null) => void;
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
      {projects.length > 1 && (
        <div className="filter-chips">
          <button className={`chip toggle${active === null ? " on" : ""}`} onClick={() => onProject(null)}>All</button>
          {projects.map((p) => (
            <button key={p} className={`chip toggle${active === p ? " on" : ""}`} onClick={() => onProject(p)}>{p}</button>
          ))}
        </div>
      )}
    </div>
  );
}
