"use client";
import { useState } from "react";
import { Star } from "lucide-react";
import { addFavorite, addRefusal, MAX_NAME, type FilterFavorite } from "@/lib/filterFavorites";
import { narrowed } from "@/lib/filterMemory";
import type { ListFilters } from "@/lib/appLocation";

/**
 * "Save these filters as a favourite" — the star, and the field that names them
 * (RIC-306).
 *
 * It rides at the right-hand end of the sticky active-filters bar rather than in the
 * favourites row itself, because that bar *is* the report of the filters this button
 * saves: the thing you are naming is listed immediately to its left. That also puts it
 * on the one row of the toolbar that never scrolls away, which is where you are when
 * you decide a filter set was worth keeping.
 *
 * Split from FilterFavorites, which renders the chips and their edit mode elsewhere in
 * the toolbar — two DOM positions, so one component cannot serve both. The favourites
 * list is therefore owned by UnifiedList and passed to each (as page.tsx owns the one
 * useSelfUpdate its two call sites share): two independent copies of the hook would
 * mean a save here left the chip row showing yesterday's list.
 *
 * Offered only for a board that deviates from the defaults — `narrowed`, the same
 * predicate filterMemory uses — since the set a favourite of the bare board would
 * restore is one tap away as "Clear all".
 */
export default function SaveFavorite(
  { favorites, filters, onSave }:
  {
    favorites: FilterFavorite[];
    filters: ListFilters;
    onSave: (next: FilterFavorite[]) => Promise<boolean>;
  },
) {
  // `null` is closed; a string is the name being typed. One piece of state rather than
  // a flag beside a draft, so "open with no draft" and "a draft with the field shut"
  // cannot be expressed.
  const [naming, setNaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!narrowed(filters)) return null;

  const close = () => { setNaming(null); setError(null); };

  const submit = async (draft: string) => {
    const refusal = addRefusal(favorites, draft, filters);
    // The field stays open with what was typed still in it — the whole reason
    // addFavorite's refusals are a separate predicate rather than a silent no-op.
    if (refusal) { setError(refusal); return; }
    close();
    if (!await onSave(addFavorite(favorites, draft, filters))) {
      alert("Could not save the favourites.");
    }
  };

  // Both states share one wrapper, and it is the wrapper — not the star — that carries
  // the sticky pin and an opaque surface. The bar scrolls horizontally, so without a
  // gutter of its own background a chip slides right up under the star and the two
  // render on top of each other.
  if (naming === null) {
    return (
      <div className="af-action">
        <button
          className="chip fav-act icon"
          aria-label="Save these filters as a favourite" title="Save these filters"
          onClick={() => { setError(null); setNaming(""); }}
        >
          <Star size={13} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    // A column, not two more items in the bar: the bar is a single nowrap scrolling row,
    // so a refusal message has nowhere to go beside the field. Stacking them lets the
    // bar grow by one line for as long as the field is open and keeps the message under
    // the input it belongs to.
    <div className="af-action fav-save">
      <form
        className="fav-save-row"
        onSubmit={(e) => { e.preventDefault(); submit(naming); }}
      >
        <input
          className="fav-input"
          // Focused on open: the star was tapped to get here, so anything else costs a
          // second tap before they can type.
          autoFocus
          type="text"
          maxLength={MAX_NAME}
          placeholder="Name these filters…"
          aria-label="Favourite name"
          value={naming}
          onChange={(e) => { setError(null); setNaming(e.target.value); }}
          onKeyDown={(e) => { if (e.key === "Escape") close(); }}
        />
        <button className="btn sm primary" type="submit">Save</button>
        <button className="btn sm ghost" type="button" onClick={close}>Cancel</button>
      </form>
      {error && <span className="fav-err">{error}</span>}
    </div>
  );
}
