// Browser document title for the two main list tabs, mirroring how an open
// terminal reflects its ticket in the tab (see terminalTabTitle). Any value
// other than "sessions" falls back to the Tickets title (the default tab).
export function tabTitle(tab: string): string {
  return tab === "sessions" ? "Sessions — Mojito" : "Tickets — Mojito";
}
