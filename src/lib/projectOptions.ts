import type { SelectOption } from "./selectSummary";

/** The select value standing for "no project": the user's home directory. */
export const GENERAL = "__general__";

/** What "no project" reads as in the sheets — it is a real choice, not an empty one. */
export const GENERAL_LABEL = "General (home)";

/**
 * The options for a sheet's Project field: General first, then the configured projects
 * in the order the server listed them.
 *
 * A sentinel rather than `""` for General because the searchable select filters on the
 * *label*, and an option has to have a value to be selectable at all; `projectName`
 * (see useProjectPicker) is where it turns back into `null` for the wire.
 */
export function projectOptions(projects: readonly string[]): SelectOption[] {
  return [
    { value: GENERAL, label: GENERAL_LABEL },
    ...projects.map((p) => ({ value: p, label: p })),
  ];
}
