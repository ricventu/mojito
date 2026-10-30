import { createContext, useContext, useLayoutEffect, useState } from "react";
import { Outlet, useMatch } from "react-router";
import { SessionSidebar } from "@/components/sidebar/SessionSidebar";
import { useSidebar, type SidebarState } from "@/hooks/useSidebar";

interface Shell {
  sidebar: SidebarState;
  /** The terminal says when the mobile keyboard is up: a docked sidebar steps aside meanwhile. */
  setKeyboardUp(up: boolean): void;
}

const ShellContext = createContext<Shell | null>(null);

function useShell(): Shell {
  const shell = useContext(ShellContext);
  if (!shell) throw new Error("outside AppShell");
  return shell;
}

/** The session sidebar's state, for a page's toggle button. */
export const useAppSidebar = (): SidebarState => useShell().sidebar;

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
 * a row from a terminal replaces the history entry (Back keeps meaning "the board").
 */
export function AppShell() {
  const sidebar = useSidebar();
  const [keyboardUp, setKeyboardUp] = useState(false);
  const terminal = useMatch("/session/:id");

  return (
    <ShellContext.Provider value={{ sidebar, setKeyboardUp }}>
      {!(keyboardUp && sidebar.docked) && (
        <SessionSidebar sidebar={sidebar} currentId={terminal?.params.id} replace={terminal !== null} />
      )}
      <Outlet />
    </ShellContext.Provider>
  );
}
