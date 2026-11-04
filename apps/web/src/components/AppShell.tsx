import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useState } from "react";
import { Outlet, useMatch, useSearchParams } from "react-router";
import { NewTicketSheet } from "@/components/sheets/NewTicketSheet";
import { SessionSidebar } from "@/components/sidebar/SessionSidebar";
import { usePeers } from "@/hooks/usePeers";
import { useProjects } from "@/hooks/useProjects";
import { useSidebar, type SidebarState } from "@/hooks/useSidebar";
import { appTitle } from "@/lib/peers";

interface Shell {
  sidebar: SidebarState;
  /** The terminal says when the mobile keyboard is up: a docked sidebar steps aside meanwhile. */
  setKeyboardUp(up: boolean): void;
  /** Opens the New ticket sheet, with `project` preselected when this instance maps it. */
  newTicket(project?: string | null): void;
}

const ShellContext = createContext<Shell | null>(null);

function useShell(): Shell {
  const shell = useContext(ShellContext);
  if (!shell) throw new Error("outside AppShell");
  return shell;
}

/** The session sidebar's state, for a page's toggle button. */
export const useAppSidebar = (): SidebarState => useShell().sidebar;

/** Opens the New ticket sheet: the board, the sidebar and the terminal header share one. */
export const useNewTicket = (): Shell["newTicket"] => useShell().newTicket;

/**
 * Hides a docked sidebar while `up`, from the commit that raised the keyboard (a layout
 * effect: the terminal's box changes once, never a frame with both).
 */
export function useKeyboardUp(up: boolean): void {
  const { setKeyboardUp } = useShell();
  useLayoutEffect(() => {
    setKeyboardUp(up);
    return () => setKeyboardUp(false);
  }, [up, setKeyboardUp]);
}

/**
 * Every page's frame: the session sidebar, drawn once so a pinned one stays put from page to
 * page. Docked, it is a fixed column that sets `--dock-width` (index.css), and each page starts
 * after it; otherwise an overlay. The row of the terminal on screen is highlighted, and picking
 * a row from a terminal replaces the history entry (Back keeps meaning "the board"). It also
 * holds the New ticket sheet, which every page can open.
 */
export function AppShell() {
  const sidebar = useSidebar();
  const [keyboardUp, setKeyboardUp] = useState(false);
  const projects = useProjects();
  // `{ project }` preselects one; `{}` opens it with none.
  const [ticketSheet, setTicketSheet] = useState<{ project?: string } | null>(null);
  const newTicket = useCallback((project?: string | null) => setTicketSheet({ project: project ?? undefined }), []);
  // Only a project this instance maps: a peer's session may name one it does not (the task runs here).
  const preselected =
    ticketSheet?.project && projects.data?.some((p) => p.name === ticketSheet.project) ? ticketSheet.project : undefined;
  const self = usePeers().data?.self;
  useEffect(() => {
    document.title = appTitle(self);
  }, [self]);
  const terminal = useMatch("/session/:id");
  const [params] = useSearchParams();
  const current = terminal ? { host: params.get("host"), id: terminal.params.id ?? "" } : undefined;

  return (
    <ShellContext.Provider value={{ sidebar, setKeyboardUp, newTicket }}>
      {!(keyboardUp && sidebar.docked) && (
        <SessionSidebar sidebar={sidebar} current={current} replace={terminal !== null} />
      )}
      <Outlet />
      {ticketSheet && <NewTicketSheet project={preselected} onClose={() => setTicketSheet(null)} />}
    </ShellContext.Provider>
  );
}
