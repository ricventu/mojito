import { ArrowLeft } from "lucide-react";
import { Link } from "react-router";
import { SidebarToggle } from "@/components/sidebar/SidebarToggle";
import { Button } from "@/components/ui/button";
import { boardHref } from "@/lib/boardReturn";
import { DefaultsCard } from "./DefaultsCard";
import { FavoritesCard } from "./FavoritesCard";
import { ProjectsCard } from "./ProjectsCard";
import { PromptsCard } from "./PromptsCard";
import { ThemeCard } from "./ThemeCard";

/** `/settings`: projects, favourite filters, per-status launch defaults, prompts and theme. Full-bleed, so it pays the safe-area insets itself. */
export function SettingsPage() {
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
        <FavoritesCard />
        <DefaultsCard />
        <PromptsCard />
        <ThemeCard />
      </div>
    </main>
  );
}
