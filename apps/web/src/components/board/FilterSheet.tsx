import { useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SHEET_CONTENT_CLASS } from "@/components/sheets/styles";
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

/**
 * Footer action: name the current filters and save them as a favourite (a same name updates
 * that one). Offered only once settings have loaded: the list it adds to must be the
 * server's. The toast waits for the server; a refused save keeps the name to fix.
 */
function SaveFavorite({ filters }: { filters: BoardFilters }) {
  const { ready, save } = useFavorites();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!isFiltered(filters) || saving) return;
    const typed = name.trim();
    const search = canonicalSearch(filters);
    // Filled by the update, which runs on the list current when the write is queued.
    const outcome = { replaced: false, stored: typed };
    setSaving(true);
    const saved = await save((current) => {
      const { list, replaced } = addFavorite(current, typed, search);
      // A same-name save keeps the stored name's capitalisation: name that one.
      outcome.replaced = replaced;
      outcome.stored = list.find((f) => f.name.toLowerCase() === typed.toLowerCase())?.name ?? typed;
      return list;
    });
    setSaving(false);
    if (!saved) return;
    toast.success(outcome.replaced ? `Updated ${outcome.stored}` : `Saved ${outcome.stored}`);
    setNaming(false);
    setName("");
  }

  if (!naming) {
    return (
      <Button variant="outline" disabled={!ready || !isFiltered(filters)} onClick={() => setNaming(true)}>
        Save as favourite
      </Button>
    );
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="flex gap-2">
      <Input
        autoFocus
        aria-label="Favourite name"
        placeholder="Favourite name"
        maxLength={60}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Button type="submit" disabled={!ready || saving || name.trim() === "" || !isFiltered(filters)}>
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
        showCloseButton={false}
        className={cn(
          "overflow-y-auto",
          wide ? "pt-[var(--sat)] pr-[var(--sar)] pb-[max(1rem,var(--sab))]" : SHEET_CONTENT_CLASS,
        )}
      >
        <SheetHeader className="flex-row items-center justify-between">
          <SheetTitle>Filters</SheetTitle>
          <SheetClose asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Close">
              <X size={16} />
            </Button>
          </SheetClose>
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
        <div className="mt-auto flex flex-col gap-2 px-4">
          <Button variant="ghost" disabled={!isFiltered(filters)} onClick={() => setFilters(NO_FILTERS)}>
            Clear
          </Button>
          <SaveFavorite filters={filters} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
