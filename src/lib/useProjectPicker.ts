"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "./client";
import { knownProject } from "./sheetProject";

/** The `<select>` value standing for "no project": the user's home directory. */
export const GENERAL = "__general__";

/**
 * The Project field shared by the New ticket and New session sheets: the option list
 * from /api/projects, and the selection — pre-set to `defaultProject` (see
 * newTicketProject for where that comes from).
 *
 * The glue half of the split this repo keeps everywhere (cf. useToken ÷
 * resolveInitialToken): the rule about which pre-selection survives lives in
 * `knownProject`, which is testable in the node-only vitest setup, and only the fetch
 * and the state live here.
 */
export function useProjectPicker(token: string, defaultProject: string | null) {
  const [projects, setProjects] = useState<string[]>([]);
  const [project, setProject] = useState(defaultProject ?? GENERAL);

  useEffect(() => {
    apiFetch(token, "/api/projects")
      .then((r) => (r.ok ? r.json() : { projects: [] }))
      .then((d: { projects: string[] }) => {
        setProjects(d.projects);
        // The pre-selection is made a render before this list exists, and it can name a
        // project projects.json no longer has. Applied to the live value rather than to
        // `defaultProject`, so it cannot undo a choice the user made meanwhile.
        setProject((p) => (p === GENERAL ? p : knownProject(p, d.projects) ?? GENERAL));
      })
      .catch(() => setProjects([]));
  }, [token]);

  return { projects, project, setProject, projectName: project === GENERAL ? null : project };
}
