import { PanelLeft } from "lucide-react";
import { useAppSidebar } from "@/components/AppShell";
import { Button } from "@/components/ui/button";

/** The session sidebar's button, in every page's header. */
export function SidebarToggle() {
  const sidebar = useAppSidebar();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="shrink-0"
      aria-label="Sessions"
      aria-expanded={sidebar.open}
      onClick={sidebar.toggle}
    >
      <PanelLeft size={16} />
    </Button>
  );
}
