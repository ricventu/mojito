"use client";

export const NO_PROJECT = "No project";

export default function FilterBar(
  { query, onQuery, projects, active, onProject, placeholder }:
  {
    query: string;
    onQuery: (q: string) => void;
    projects: string[];
    active: string | null;
    onProject: (p: string | null) => void;
    placeholder?: string;
  },
) {
  return (
    <div className="filter">
      <input
        className="search"
        type="search"
        inputMode="search"
        placeholder={placeholder ?? "Search…"}
        value={query}
        onChange={(e) => onQuery(e.target.value)}
      />
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
