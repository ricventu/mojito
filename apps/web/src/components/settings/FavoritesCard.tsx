import { useState } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import type { Favorite } from "@mojito/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useFavorites, type Favorites } from "@/hooks/useFavorites";
import { useSettings } from "@/hooks/useSettings";
import { moveFavorite, removeFavorite, renameFavorite, renameRefusal } from "@/lib/favorites";

interface RowProps {
  favorites: Favorite[];
  index: number;
  save: Favorites["save"];
}

/**
 * One favourite, keyed by its position. The draft is local; it commits on blur or Enter, and
 * Escape drops it. When the name stored at this position changes (a rename landed, a move, another
 * device), the draft follows it. Every write is an update of the list current when it is queued,
 * so a rename committed on blur and the ↑ tap that caused the blur both land.
 */
function Row({ favorites, index, save }: RowProps) {
  const name = favorites[index].name;
  const [draft, setDraft] = useState(name);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [synced, setSynced] = useState(name);
  if (synced !== name) {
    setSynced(name);
    setDraft(name);
    setRefusal(null);
  }

  function commit() {
    if (draft.trim() === name) {
      setDraft(name);
      setRefusal(null);
      return;
    }
    const why = renameRefusal(favorites, index, draft);
    setRefusal(why);
    if (why === null) void save((current) => renameFavorite(current, index, draft));
  }

  return (
    <li className="flex items-start gap-2 py-2">
      <div className="min-w-0 flex-1">
        <Input
          value={draft}
          maxLength={60}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            else if (e.key === "Escape") {
              setDraft(name);
              setRefusal(null);
            }
          }}
          aria-label={`Name of ${name}`}
          aria-invalid={refusal ? true : undefined}
          autoCapitalize="off"
          spellCheck={false}
        />
        {refusal && <p className="mt-1 text-sm text-destructive">{refusal}</p>}
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        className="mt-0.5"
        aria-label={`Move ${name} up`}
        disabled={index === 0}
        onClick={() => void save((current) => moveFavorite(current, index, -1))}
      >
        <ArrowUp size={14} />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="mt-0.5"
        aria-label={`Move ${name} down`}
        disabled={index === favorites.length - 1}
        onClick={() => void save((current) => moveFavorite(current, index, 1))}
      >
        <ArrowDown size={14} />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="mt-0.5"
        aria-label={`Delete ${name}`}
        onClick={() => void save((current) => removeFavorite(current, index))}
      >
        <Trash2 size={14} />
      </Button>
    </li>
  );
}

/**
 * The saved board filters: rename, reorder and delete. Saving one happens from the board's
 * filter sheet. The rows exist only once settings have loaded, so no write starts from a guess.
 */
export function FavoritesCard() {
  const settings = useSettings();
  const { favorites, ready, save } = useFavorites();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Favourites</CardTitle>
        <CardDescription>Saved board filters, in the order the board shows them.</CardDescription>
      </CardHeader>
      {settings.isError ? (
        <CardContent>
          <p className="text-sm text-destructive">{settings.error.message}</p>
        </CardContent>
      ) : ready ? (
        <CardContent>
          {favorites.length === 0 ? (
            <p className="text-sm text-muted-foreground">No favourites yet. Filter the board, then Save as favourite.</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {favorites.map((_, i) => (
                // By position: a rename must not remount the row under the tap that blurred it.
                <Row key={i} favorites={favorites} index={i} save={save} />
              ))}
            </ul>
          )}
        </CardContent>
      ) : null}
    </Card>
  );
}
