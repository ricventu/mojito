import { useEffect, useRef } from "react";
import { ArrowLeft } from "lucide-react";
import { Link, useLocation } from "react-router";
import { SidebarToggle } from "@/components/sidebar/SidebarToggle";
import { Button } from "@/components/ui/button";
import { useProjects } from "@/hooks/useProjects";
import { useSettings } from "@/hooks/useSettings";
import { boardHref } from "@/lib/boardReturn";
import { CommandsCard } from "./CommandsCard";
import { DefaultsCard } from "./DefaultsCard";
import { FavoritesCard } from "./FavoritesCard";
import { ProjectsCard } from "./ProjectsCard";
import { PromptsCard } from "./PromptsCard";
import { ThemeCard } from "./ThemeCard";

/**
 * `#commands` (the board's "Manage commands") scrolls to the Commands card once, after the cards
 * above it have loaded: scrolled earlier, the Projects list landing would push it down again.
 */
function useScrollToCommands() {
  const { hash } = useLocation();
  const projects = useProjects();
  const settings = useSettings();
  const loaded = projects.data !== undefined && settings.data !== undefined;
  const done = useRef(false);
  useEffect(() => {
    if (hash !== "#commands" || !loaded || done.current) return;
    done.current = true;
    document.getElementById("commands")?.scrollIntoView({ block: "start" });
  }, [hash, loaded]);
}

/** `/settings`: projects, commands, favourite filters, per-status launch defaults, prompts and theme. Full-bleed, so it pays the safe-area insets itself. */
export function SettingsPage() {
  useScrollToCommands();
  return (
    // It starts after a docked session sidebar (AppShell).
    <main className="ml-[var(--dock-width)] min-h-dvh pt-[var(--sat)] pr-[var(--sar)] pb-[var(--sab)] pl-[var(--sal)]">
      <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-3">
        <header className="flex items-center gap-2">
          <SidebarToggle />
          <Button asChild variant="ghost" size="sm" className="shrink-0">
            <Link to={boardHref()}>
              <ArrowLeft size={16} /> Board
            </Link>
          </Button>
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold">Settings</h1>
        </header>
        <ProjectsCard />
        <div id="commands" className="scroll-mt-[calc(var(--sat)+0.75rem)]">
          <CommandsCard />
        </div>
        <FavoritesCard />
        <DefaultsCard />
        <PromptsCard />
        <ThemeCard />
      </div>
    </main>
  );
}
