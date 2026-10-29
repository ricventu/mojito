import { useState } from "react";
import { ListFilter, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { filterCount, type BoardFilters } from "@/lib/filters";
import { FavoriteChips } from "./FavoriteChips";
import { FilterSheet } from "./FilterSheet";

interface Props {
  filters: BoardFilters;
  setFilters: (next: BoardFilters) => void;
}

/** The search field, the Filter button (with its count) and the favourite chips under the toolbar. */
export function FilterBar({ filters, setFilters }: Props) {
  const [open, setOpen] = useState(false);
  const count = filterCount(filters);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Search tickets"
            placeholder="Search tickets…"
            value={filters.q}
            onChange={(e) => setFilters({ ...filters, q: e.target.value })}
            className="pr-9 pl-8 [&::-webkit-search-cancel-button]:appearance-none"
          />
          {filters.q !== "" && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Clear search"
              className="absolute top-1/2 right-0.5 -translate-y-1/2"
              onClick={() => setFilters({ ...filters, q: "" })}
            >
              <X size={14} />
            </Button>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <ListFilter size={14} /> Filter{count > 0 && ` · ${count}`}
        </Button>
      </div>
      <FavoriteChips filters={filters} setFilters={setFilters} />
      <FilterSheet open={open} onOpenChange={setOpen} filters={filters} setFilters={setFilters} />
    </div>
  );
}
