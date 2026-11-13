import { Loader2, Zap } from "lucide-react";
import { Link } from "react-router";
import type { Command } from "@mojito/shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useRunCommand } from "@/hooks/useRunCommand";
import { CommandIconView } from "@/lib/commandIcons";

/** The project header's quick commands (RIC-581): pick one to open its session; the last item manages them. */
export function CommandsMenu({ project, commands }: { project: string; commands: Command[] }) {
  const run = useRunCommand(project);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Commands for ${project}`} title="Commands" disabled={run.isPending}>
          {run.isPending ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {commands.map((c) => (
          <DropdownMenuItem key={c.id} onSelect={() => run.mutate(c)}>
            <CommandIconView icon={c.icon} />
            {c.name}
          </DropdownMenuItem>
        ))}
        {commands.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem asChild>
          <Link to="/settings#commands">Manage commands</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
