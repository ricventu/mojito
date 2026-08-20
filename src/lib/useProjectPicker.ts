"use client";
import { useEffect, useState } from "react";
import { useProjects } from "./useProjects";
import { knownProject } from "./sheetProject";
import { GENERAL } from "./projectOptions";

/**
 * The Project field shared by the New ticket and New session sheets: the option list
 * from /api/projects (see useProjects), and the selection — pre-set to `defaultProject`
 * (see newTicketProject for where that comes from).
 *
 * The glue half of the split this repo keeps everywhere (cf. useToken ÷
 * resolveInitialToken): the rule about which pre-selection survives lives in
 * `knownProject`, which is testable in the node-only vitest setup, and only the fetch
 * and the state live here.
 */
export function useProjectPicker(token: string, defaultProject: string | null) {
  const projects = useProjects(token);
  const [project, setProject] = useState(defaultProject ?? GENERAL);

  // The pre-selection is made a render before the list exists, and it can name a
  // project projects.json no longer has. Applied to the live value rather than to
  // `defaultProject`, so it cannot undo a choice the user made meanwhile.
  useEffect(() => {
    setProject((p) => (p === GENERAL ? p : knownProject(p, projects) ?? GENERAL));
  }, [projects]);

  return { projects, project, setProject, projectName: project === GENERAL ? null : project };
}
