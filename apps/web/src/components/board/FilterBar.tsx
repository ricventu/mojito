import { useEffect, useRef, useState } from "react";
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

  // The input owns what is typed: the url follows through an asynchronous navigation, and an
  // input driven straight from it is reset under the caret mid-edit. The draft re-syncs only
  // when `q` changes to something this input did not write (a chip, Clear filters).
  const [draft, setDraft] = useState(filters.q);
  const written = useRef<string[]>([]);
  useEffect(() => {
    const at = written.current.indexOf(filters.q);
    if (at !== -1) written.current = written.current.slice(at + 1);
    else {
      written.current = [];
      setDraft(filters.q);
    }
  }, [filters.q]);
  const type = (q: string) => {
    setDraft(q);
    written.current.push(q);
    setFilters({ ...filters, q });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Search tickets"
            placeholder="Search tickets…"
            value={draft}
            onChange={(e) => type(e.target.value)}
            className="pr-9 pl-8 [&::-webkit-search-cancel-button]:appearance-none"
          />
          {draft !== "" && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Clear search"
              className="absolute top-1/2 right-0.5 -translate-y-1/2"
              onClick={() => {
                setDraft("");
                setFilters({ ...filters, q: "" });
              }}
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
