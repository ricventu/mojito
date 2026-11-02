import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import type { SessionMeta } from "@mojito/shared";
import { buttonVariants } from "@/components/ui/button";
import type { SidebarGroup } from "@/lib/sidebar";
import { cn } from "@/lib/utils";

interface HostProps {
  name: string;
  count: number;
  online: boolean;
  /** Another instance: its own client, in this tab (leaving this host). Absent for this one. */
  href?: string;
  /** The first band touches the header's border, so it draws none above itself. */
  first?: boolean;
  children: ReactNode;
}

/**
 * One instance's sessions under a band naming it — every instance gets the same band, this one
 * first. The band sticks to the top of the list while its sessions scroll under it, so the
 * host of a row is always on screen. An offline instance is its band alone, dimmed. Hosts carry
 * no status dot: in the sidebar a dot always means a session's state.
 */
export function HostSection({ name, count, online, href, first = false, children }: HostProps) {
  return (
    <section aria-label={`Sessions on ${name}`} className="pb-2">
      <h3
        className={cn(
          "sticky top-0 z-10 -mx-2 flex h-9 items-center gap-2 border-b bg-muted pr-2 pl-4 text-xs font-semibold tracking-wide uppercase",
          !first && "border-t",
          !online && "text-muted-foreground",
        )}
      >
        <span className="min-w-0 truncate">{name}</span>
        {online ? (
          <span className="ml-auto font-normal text-muted-foreground tabular-nums">
            {count}
            <span className="sr-only"> sessions</span>
          </span>
        ) : (
          <span className="shrink-0 font-normal tracking-normal normal-case">· offline</span>
        )}
        {href && (
          <a
            href={href}
            aria-label={`Open Mojito on ${name}`}
            className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "shrink-0 text-muted-foreground", !online && "ml-auto")}
          >
            <ArrowUpRight size={16} />
          </a>
        )}
      </h3>
      {children}
    </section>
  );
}

/** A host's sessions grouped by project, each project under its small heading. */
export function GroupList({
  groups,
  nested,
  row,
}: {
  groups: SidebarGroup[];
  /** Under a host band: the project headings are one level down. */
  nested: boolean;
  row(s: SessionMeta): ReactNode;
}) {
  const Heading = nested ? "h4" : "h3";
  if (groups.length === 0) return <p className="px-2 py-3 text-sm text-muted-foreground">No live sessions</p>;
  return groups.map((g) => (
    <section key={g.project ?? "general"} className="flex flex-col gap-0.5">
      <Heading className="truncate px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">{g.project ?? "General"}</Heading>
      <ul className="flex flex-col gap-0.5">{g.sessions.map(row)}</ul>
    </section>
  ));
}
