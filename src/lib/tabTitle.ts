// Browser document title for the two remaining list tabs, mirroring how an open
// terminal reflects its ticket in the tab (see terminalTabTitle). Takes the view kind
// from the url (see appLocation): anything other than "stacks" is the unified
// tickets+sessions list, including the docs overlay opened from it.
export function tabTitle(tab: string): string {
  return tab === "stacks" ? "Stacks — Mojito" : "Tickets — Mojito";
}
