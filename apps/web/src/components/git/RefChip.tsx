import { FolderGit2 } from "lucide-react";
import type { GraphRef } from "@mojito/shared";
import { cn } from "@/lib/utils";

/** Local branch (a folder icon when checked out in a worktree), `origin/…`, or tag, each told apart by its look. */
export function RefChip({
  gitRef: r,
  highlighted,
  className,
}: {
  gitRef: GraphRef;
  highlighted: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex h-4.5 min-w-0 shrink items-center gap-0.5 rounded px-1 text-[10px] leading-none font-medium",
        highlighted
          ? "bg-primary text-primary-foreground"
          : r.kind === "local"
            ? "bg-secondary text-secondary-foreground"
            : r.kind === "remote"
              ? "border text-muted-foreground"
              : "border border-dashed text-muted-foreground",
        className,
      )}
      title={r.kind === "tag" ? `tag ${r.name}` : r.name}
    >
      {r.worktree && <FolderGit2 size={10} className="shrink-0" aria-label="checked out in a worktree" />}
      <span className="truncate">{r.name}</span>
    </span>
  );
}
