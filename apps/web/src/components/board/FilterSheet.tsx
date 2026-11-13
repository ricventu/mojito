import { useState } from "react";
import { Star, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { BOTTOM_SHEET_CLASS } from "@/components/sheets/styles";
import { useFavorites } from "@/hooks/useFavorites";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useProjects } from "@/hooks/useProjects";
import {
  activeFavorite,
  addFavorite,
  favoriteIndex,
  favoriteName,
  uniqueName,
  updateFavorite,
} from "@/lib/favorites";
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

function FilterChip({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <Button type="button" size="sm" variant={on ? "default" : "outline"} aria-pressed={on} onClick={onToggle}>
      {label}
    </Button>
  );
}

/**
 * Footer actions for favourites. The content of an open sheet is mounted afresh on each
 * open, so `base` is the favourite the board showed when the sheet opened (its chip lit):
 * once the filters move away from it, Update gives it the new filters. Filters already saved
 * as a favourite show its name instead of a save. A new favourite's name is filled in from the
 * filters, and follows them until the human types. Offered only once settings have loaded:
 * the list written must be the server's. Toasts wait for the server; a refused save keeps the
 * form to retry.
 */
function FavoriteActions({ filters }: { filters: BoardFilters }) {
  const { favorites, ready, save } = useFavorites();
  // `undefined` until settings have loaded, then the base's name or null.
  const [base, setBase] = useState<string | null | undefined>(undefined);
  const [naming, setNaming] = useState(false);
  const [typed, setTyped] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const search = canonicalSearch(filters);
  const active = activeFavorite(favorites, search);
  if (base === undefined && ready) setBase(active === -1 ? null : favorites[active].name);
  const baseIndex = base ? favoriteIndex(favorites, base) : -1;
  const name = typed ?? uniqueName(favorites, favoriteName(filters));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const wanted = name.trim();
    if (!isFiltered(filters) || saving || wanted === "") return;
    // Filled by the update, which runs on the list current when the write is queued.
    const outcome = { replaced: false, stored: wanted };
    setSaving(true);
    const saved = await save((current) => {
      const { list, replaced } = addFavorite(current, wanted, search);
      // A same-name save keeps the stored name's capitalisation: name that one.
      outcome.replaced = replaced;
      outcome.stored = list[favoriteIndex(list, wanted)]?.name ?? wanted;
      return list;
    });
    setSaving(false);
    if (!saved) return;
    toast.success(outcome.replaced ? `Updated ${outcome.stored}` : `Saved ${outcome.stored}`);
    setBase(outcome.stored);
    setNaming(false);
    setTyped(null);
  }

  async function update() {
    if (!base || !isFiltered(filters) || saving) return;
    const outcome = { name: null as string | null };
    setSaving(true);
    const saved = await save((current) => {
      const at = favoriteIndex(current, base);
      if (at === -1) return current;
      const list = updateFavorite(current, at, search);
      outcome.name = list[at].name;
      return list;
    });
    setSaving(false);
    if (outcome.name === null) {
      toast.error(`${base} is no longer a favourite`);
      return;
    }
    if (!saved) return;
    toast.success(`Updated ${outcome.name}`);
    setBase(outcome.name);
  }

  if (naming) {
    return (
      <form onSubmit={(e) => void submit(e)} className="flex gap-2">
        <Input
          autoFocus
          aria-label="Favourite name"
          placeholder="Favourite name"
          maxLength={60}
          value={name}
          onChange={(e) => setTyped(e.target.value)}
        />
        <Button type="submit" disabled={!ready || saving || name.trim() === "" || !isFiltered(filters)}>
          Save
        </Button>
      </form>
    );
  }
  if (active !== -1) {
    return (
      <p className="flex min-h-9 items-center justify-center gap-1.5 text-sm text-muted-foreground">
        <Star size={14} className="shrink-0" />
        <span className="min-w-0 truncate">Saved as {favorites[active].name}</span>
      </p>
    );
  }
  const canSave = ready && isFiltered(filters) && !saving;
  return (
    <>
      {baseIndex !== -1 && (
        <Button disabled={!canSave} onClick={() => void update()}>
          <Star size={14} />
          <span className="min-w-0 truncate">Update {favorites[baseIndex].name}</span>
        </Button>
      )}
      <Button variant="outline" disabled={!canSave} onClick={() => setNaming(true)}>
        {baseIndex !== -1 ? "Save as new favourite" : "Save as favourite"}
      </Button>
    </>
  );
}

/** Projects, statuses and active sessions of the board, applied live: there is no Apply button. */
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
          wide ? "pt-[var(--sat)] pr-[var(--sar)] pb-[max(1rem,var(--sab))]" : BOTTOM_SHEET_CLASS,
        )}
      >
        <SheetHeader className="flex-row items-center justify-between">
          <SheetTitle>Filters</SheetTitle>
          <SheetClose asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Close">
              <X size={16} />
            </Button>
          </SheetClose>
          <SheetDescription className="sr-only">Pick projects, statuses and sessions to show on the board.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 px-4">
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium">Projects</legend>
            {names.length === 0 && <p className="text-sm text-muted-foreground">No projects configured.</p>}
            {names.map((name) => (
              <label key={name} className="flex min-h-9 items-center gap-3 text-sm">
                <Checkbox
                  checked={filters.projects.includes(name)}
                  onCheckedChange={() => setFilters({ ...filters, projects: toggle(filters.projects, name) })}
                />
                <span className="min-w-0 truncate">{name}</span>
              </label>
            ))}
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Status</legend>
            <div className="flex flex-wrap gap-2">
              {FILTER_STATUSES.map((status) => (
                <FilterChip
                  key={status}
                  label={status}
                  on={filters.statuses.includes(status)}
                  onToggle={() => setFilters({ ...filters, statuses: toggle(filters.statuses, status) })}
                />
              ))}
            </div>
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Sessions</legend>
            <div className="flex flex-wrap gap-2">
              <FilterChip
                label="Active"
                on={filters.live}
                onToggle={() => setFilters({ ...filters, live: !filters.live })}
              />
            </div>
          </fieldset>
        </div>
        <div className="mt-auto flex flex-col gap-2 px-4">
          <Button variant="ghost" disabled={!isFiltered(filters)} onClick={() => setFilters(NO_FILTERS)}>
            Clear
          </Button>
          <FavoriteActions filters={filters} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
