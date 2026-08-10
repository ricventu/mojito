// Browser document title for the two remaining list tabs, mirroring how an open
// terminal reflects its ticket in the tab (see terminalTabTitle). Anything other than
// "stacks" is the unified tickets+sessions list — including a "sessions" value still
// stored by a browser from before the two views merged.
export function tabTitle(tab: string): string {
  return tab === "stacks" ? "Stacks — Mojito" : "Tickets — Mojito";
}
