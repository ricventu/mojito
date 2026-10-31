import { PanelLeft } from "lucide-react";
import { useAppSidebar } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { usePeers } from "@/hooks/usePeers";
import { waitingPeers } from "@/lib/peers";

/**
 * The session sidebar's button, in every page's header. An amber dot says a session on another
 * instance is asking for input — the board's waiting pill only counts this one's.
 */
export function SidebarToggle() {
  const sidebar = useAppSidebar();
  const peers = usePeers();
  const waiting = waitingPeers(peers.data?.peers ?? []);
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="relative shrink-0"
      aria-label={waiting ? "Sessions — a session on another instance needs you" : "Sessions"}
      aria-expanded={sidebar.open}
      onClick={sidebar.toggle}
    >
      <PanelLeft size={16} />
      {waiting && <span aria-hidden className="absolute top-1 right-1 size-2 rounded-full bg-amber-500" />}
    </Button>
  );
}
