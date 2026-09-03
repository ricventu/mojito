"use client";
import { useState } from "react";
import { ChevronDown, ChevronUp, Pencil, X } from "lucide-react";
import {
  activeFavorite, favoriteFilters, moveFavorite, removeFavorite, renameFavorite,
  renameRefusal, MAX_NAME, type FilterFavorite,
} from "@/lib/filterFavorites";
import type { ListFilters } from "@/lib/appLocation";

/**
 * What the row is currently doing. A union rather than a flag beside a draft, so
 * "renaming nothing" cannot be expressed — the same rule AppView's nested docs target
 * follows.
 */
type Mode =
  | { kind: "idle" }
  | { kind: "editing"; renaming: { of: string; draft: string } | null };

const IDLE: Mode = { kind: "idle" };

/**
 * The quick-access bar for saved filter sets (RIC-306), leading the board's toolbar.
 *
 * It is the coarsest "change what the board shows" control there is — one tap for a
 * whole filter set — which is why it sits above the project select rather than below
 * the search field: RIC-226's rule is that the rows which change what the board shows
 * lead, in order of how coarse they are.
 *
 * Applying a favourite just sets the filters, so the address bar stays the single
 * source of truth (RIC-204) and a favourite is shareable as a plain link like any
 * other board state. The chip matching the current filters paints lime, so the row
 * doubles as a report of where you are — `aria-current` rather than `aria-pressed`,
 * since tapping it again re-applies rather than toggling off.
 *
 * Saving is *not* here: the star lives at the right-hand end of the sticky
 * active-filters bar, beside the filters it saves (SaveFavorite). This row holds the
 * saved sets and the pencil that manages them, which is a different subject — and the
 * split is why the favourites list is owned by UnifiedList and handed to both.
 *
 * Rename, reorder and delete live behind that pencil instead of inside the chips:
 * three controls per chip do not fit a 320px phone, and keeping them out means a chip
 * is one unambiguous tap target, which is the whole point of a quick-access bar.
 * Reordering is arrows and not dragging — HTML5 drag events do not exist under touch,
 * so real dragging would mean a drag library on the board chunk, which today carries
 * none, for a list of a handful of names.
 */
export default function FilterFavorites(
  { favorites, filters, onApply, onSave }:
  {
    favorites: FilterFavorite[];
    filters: ListFilters;
    onApply: (f: ListFilters) => void;
    onSave: (next: FilterFavorite[]) => Promise<boolean>;
  },
) {
  const [mode, setMode] = useState<Mode>(IDLE);
  // Why the last rename was refused, shown under the field it was typed in. Cleared by
  // the next keystroke, so a corrected name does not carry a stale complaint.
  const [error, setError] = useState<string | null>(null);

  const active = activeFavorite(favorites, filters);

  const store = async (next: FilterFavorite[]) => {
    if (!await onSave(next)) alert("Could not save the favourites.");
  };

  const close = () => { setError(null); setMode(IDLE); };

  const submitRename = async (of: string, draft: string) => {
    const refusal = renameRefusal(favorites, of, draft);
    if (refusal) { setError(refusal); return; }
    const next = renameFavorite(favorites, of, draft);
    setMode({ kind: "editing", renaming: null });
    setError(null);
    if (next) await store(next);
  };

  const remove = async (name: string) => {
    if (!confirm(`Delete the favourite "${name}"?`)) return;
    const next = removeFavorite(favorites, name);
    // Nothing left to edit, so the mode the pencil opened has no subject any more.
    if (next.length === 0) setMode(IDLE);
    await store(next);
  };

  // Nothing saved: no row at all, so a board whose owner never saved a filter set
  // grows no furniture it has no use for. The star that starts one is on the sticky
  // bar, not here, so this is not the way in.
  if (favorites.length === 0) return null;

  if (mode.kind === "editing") {
    const renaming = mode.renaming;
    return (
      <div className="favs-edit">
        {favorites.map((f, i) => (
          <div className="fav-row" key={f.name}>
            <button
              className="btn sm ghost icon"
              aria-label={`Move ${f.name} up`} title="Move up"
              disabled={i === 0}
              onClick={() => store(moveFavorite(favorites, f.name, -1))}
            >
              <ChevronUp size={14} aria-hidden="true" />
            </button>
            <button
              className="btn sm ghost icon"
              aria-label={`Move ${f.name} down`} title="Move down"
              disabled={i === favorites.length - 1}
              onClick={() => store(moveFavorite(favorites, f.name, 1))}
            >
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            {renaming?.of === f.name ? (
              <form
                className="fav-rename"
                onSubmit={(e) => { e.preventDefault(); submitRename(f.name, renaming.draft); }}
              >
                <input
                  className="fav-input"
                  // Focused on open, as with the save field.
                  autoFocus
                  type="text"
                  maxLength={MAX_NAME}
                  aria-label={`Rename ${f.name}`}
                  value={renaming.draft}
                  onChange={(e) => {
                    setError(null);
                    setMode({ kind: "editing", renaming: { of: f.name, draft: e.target.value } });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") { setError(null); setMode({ kind: "editing", renaming: null }); }
                  }}
                />
                <button className="btn sm primary" type="submit">Rename</button>
              </form>
            ) : (
              <button
                className="fav-name"
                title="Rename"
                onClick={() => {
                  setError(null);
                  setMode({ kind: "editing", renaming: { of: f.name, draft: f.name } });
                }}
              >
                {f.name}
              </button>
            )}
            <button
              className="btn sm ghost icon fav-del"
              aria-label={`Delete ${f.name}`} title="Delete"
              onClick={() => remove(f.name)}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        ))}
        {error && <span className="fav-err">{error}</span>}
        <div className="fav-done">
          <button className="btn sm ghost" onClick={close}>Done</button>
        </div>
      </div>
    );
  }

  return (
    <div className="favs">
      {favorites.map((f) => (
        <button
          key={f.name}
          className={`chip fav-chip${active === f.name ? " on" : ""}`}
          aria-current={active === f.name ? "true" : undefined}
          onClick={() => onApply(favoriteFilters(f))}
        >
          {f.name}
        </button>
      ))}
      <button
        className="chip fav-act icon"
        aria-label="Edit favourites" title="Edit favourites"
        onClick={() => { setError(null); setMode({ kind: "editing", renaming: null }); }}
      >
        <Pencil size={13} aria-hidden="true" />
      </button>
    </div>
  );
}
