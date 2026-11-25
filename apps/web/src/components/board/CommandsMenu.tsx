import { FileText, GitGraph, Zap } from "lucide-react";
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
import { CommandIconView } from "@/lib/commandIcons";
import { docsHref } from "@/lib/docs/url";
import { gitHref } from "@/lib/git/url";

/**
 * The project header's quick commands (RIC-581): pick one to open its run sheet (RIC-622, `onRun`);
 * the last item manages them.
 */
export function CommandsMenu({ project, commands, onRun }: { project: string; commands: Command[]; onRun: (command: Command) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Commands for ${project}`} title="Commands">
          <Zap size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {/* Below sm the header has no room for these two buttons: they live here. */}
        <DropdownMenuItem asChild className="sm:hidden">
          <Link to={gitHref(project)}>
            <GitGraph size={16} />
            Git graph
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="sm:hidden">
          <Link to={docsHref(project)}>
            <FileText size={16} />
            Docs
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator className="sm:hidden" />
        {commands.map((c) => (
          <DropdownMenuItem key={c.id} onSelect={() => onRun(c)}>
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
