import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFavorites } from "@/hooks/useFavorites";
import { activeFavorite } from "@/lib/favorites";
import { canonicalSearch, NO_FILTERS, parseFilters, type BoardFilters } from "@/lib/filters";

interface Props {
  filters: BoardFilters;
  setFilters: (next: BoardFilters) => void;
}

/** One tap per favourite; the one matching the current filters is lit, and tapping it clears them. */
export function FavoriteChips({ filters, setFilters }: Props) {
  const { favorites } = useFavorites();
  if (favorites.length === 0) return null;
  const active = activeFavorite(favorites, canonicalSearch(filters));

  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
      {favorites.map((fav, i) => (
        <Button
          key={fav.name}
          variant={i === active ? "default" : "outline"}
          size="sm"
          className="shrink-0"
          aria-pressed={i === active}
          onClick={() => setFilters(i === active ? NO_FILTERS : parseFilters(new URLSearchParams(fav.search)))}
        >
          <Star size={14} />
          <span className="max-w-40 truncate">{fav.name}</span>
        </Button>
      ))}
    </div>
  );
}
