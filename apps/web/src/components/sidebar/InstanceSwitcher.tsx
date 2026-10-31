import { useSyncExternalStore } from "react";
import { ChevronDown } from "lucide-react";
import type { PeersAnswer } from "@mojito/shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { peerHref } from "@/lib/peers";
import { getToken, subscribeToken } from "@/lib/token";
import { PeerDot } from "./PeerSection";

/**
 * This instance's name, as a menu of the other instances: picking one opens its own client in a
 * new tab, logged in with the shared token. An offline one is listed too (it may just be asleep).
 */
export function InstanceSwitcher({ answer }: { answer: PeersAnswer }) {
  const token = useSyncExternalStore(subscribeToken, getToken);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="min-w-0 justify-start gap-1 px-2 text-base font-semibold" aria-label={`Instance: ${answer.self}`}>
          <span className="truncate">{answer.self}</span>
          <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Open another instance</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {answer.peers.map((p) => (
          <DropdownMenuItem key={p.name} asChild>
            <a href={peerHref(p, "/", token)} target="_blank" rel="noopener">
              <PeerDot online={p.online} />
              <span className="truncate">{p.name}</span>
              {!p.online && <span className="ml-auto text-xs text-muted-foreground">offline</span>}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
