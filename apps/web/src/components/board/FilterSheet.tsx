import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useFavorites } from "@/hooks/useFavorites";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useProjects } from "@/hooks/useProjects";
import { addFavorite } from "@/lib/favorites";
import {
  canonicalSearch,
  FILTER_STATUSES,
  isFiltered,
  NO_FILTERS,
  sheetProjects,
  type BoardFilters,
} from "@/lib/filters";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: BoardFilters;
  setFilters: (next: BoardFilters) => void;
}

const toggle = (list: string[], value: string) =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

/** Footer action: name the current filters and save them as a favourite (a same name updates that one). */
function SaveFavorite({ filters }: { filters: BoardFilters }) {
  const { favorites, save } = useFavorites();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const { list, replaced } = addFavorite(favorites, name, canonicalSearch(filters));
    if (list === favorites) return;
    save(list);
    toast.success(replaced ? `Updated ${name.trim()}` : `Saved ${name.trim()}`);
    setNaming(false);
    setName("");
  }

  if (!naming) {
    return (
      <Button variant="outline" disabled={!isFiltered(filters)} onClick={() => setNaming(true)}>
        Save as favourite
      </Button>
    );
  }
  return (
    <form onSubmit={submit} className="flex gap-2">
      <Input
        autoFocus
        aria-label="Favourite name"
        placeholder="Favourite name"
        maxLength={60}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Button type="submit" disabled={name.trim() === ""}>
        Save
      </Button>
    </form>
  );
}

/** Projects and statuses of the board, applied live: there is no Apply button. */
export function FilterSheet({ open, onOpenChange, filters, setFilters }: Props) {
  const projects = useProjects();
  const wide = useMediaQuery("(min-width: 640px)");
  const names = sheetProjects(
    (projects.data ?? []).map((p) => p.name),
    filters.projects,
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={wide ? "right" : "bottom"}
        className={cn(
          "overflow-y-auto",
          wide
            ? "pt-[max(0rem,var(--sat))] pr-[var(--sar)]"
            : "max-h-[92dvh] rounded-t-xl pb-[max(1rem,var(--sab))]",
        )}
      >
        <SheetHeader>
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription className="sr-only">Pick projects and statuses to show on the board.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 px-4">
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium">Projects</legend>
            {names.length === 0 && <p className="text-sm text-muted-foreground">No projects configured.</p>}
            {names.map((name) => (
              <label key={name} className="flex min-h-9 items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={filters.projects.includes(name)}
                  onChange={() => setFilters({ ...filters, projects: toggle(filters.projects, name) })}
                />
                <span className="min-w-0 truncate">{name}</span>
              </label>
            ))}
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Status</legend>
            <div className="flex flex-wrap gap-2">
              {FILTER_STATUSES.map((status) => {
                const on = filters.statuses.includes(status);
                return (
                  <Button
                    key={status}
                    type="button"
                    size="sm"
                    variant={on ? "default" : "outline"}
                    aria-pressed={on}
                    onClick={() => setFilters({ ...filters, statuses: toggle(filters.statuses, status) })}
                  >
                    {status}
                  </Button>
                );
              })}
            </div>
          </fieldset>
        </div>
        <div className="mt-auto flex flex-col gap-2 px-4 pb-4">
          <Button variant="ghost" disabled={!isFiltered(filters)} onClick={() => setFilters(NO_FILTERS)}>
            Clear
          </Button>
          <SaveFavorite filters={filters} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
