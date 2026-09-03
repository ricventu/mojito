"use client";
import { useState } from "react";
import { ChevronDown, ChevronUp, Pencil, Star, X } from "lucide-react";
import {
  activeFavorite, addFavorite, addRefusal, favoriteFilters, moveFavorite,
  removeFavorite, renameFavorite, renameRefusal, MAX_NAME,
} from "@/lib/filterFavorites";
import { narrowed } from "@/lib/filterMemory";
import { useFilterFavorites } from "@/lib/useFilterFavorites";
import type { ListFilters } from "@/lib/appLocation";

/**
 * What the row is currently doing. A union rather than three booleans, so "naming a
 * new favourite while renaming an old one" cannot be expressed at all — the same rule
 * AppView's nested docs target follows.
 */
type Mode =
  | { kind: "idle" }
  | { kind: "naming"; draft: string }
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
 * Rename, reorder and delete live behind the pencil instead of inside the chips: three
 * controls per chip do not fit a 320px phone, and keeping them out means a chip in
 * normal mode is one unambiguous tap target, which is the whole point of a quick-access
 * bar. Reordering is arrows and not dragging — HTML5 drag events do not exist under
 * touch, so real dragging would mean a drag library on the board chunk, which today
 * carries none, for a list of a handful of names.
 */
export default function FilterFavorites(
  { token, filters, onApply }:
  { token: string; filters: ListFilters; onApply: (f: ListFilters) => void },
) {
  const { favorites, save } = useFilterFavorites(token);
  const [mode, setMode] = useState<Mode>(IDLE);
  // Why the last attempt was refused, shown beside the field it was typed in. Cleared
  // by the next keystroke, so a corrected name does not carry a stale complaint.
  const [error, setError] = useState<string | null>(null);

  const active = activeFavorite(favorites, filters);
  // Offered only for a board that deviates from the defaults: the set a favourite of
  // the bare board would restore is one tap away as "Clear all".
  const canSave = narrowed(filters);

  const store = async (next: typeof favorites) => {
    if (!await save(next)) alert("Could not save the favourites.");
  };

  const beginNaming = () => { setError(null); setMode({ kind: "naming", draft: "" }); };
  const close = () => { setError(null); setMode(IDLE); };

  const submitName = async (draft: string) => {
    const refusal = addRefusal(favorites, draft, filters);
    // The field stays open with what was typed still in it, which is the whole reason
    // addFavorite's refusals are a separate predicate rather than a silent no-op.
    if (refusal) { setError(refusal); return; }
    close();
    await store(addFavorite(favorites, draft, filters));
  };

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

  if (mode.kind === "naming") {
    return (
      <form
        className="favs fav-form"
        onSubmit={(e) => { e.preventDefault(); submitName(mode.draft); }}
      >
        <input
          className="fav-input"
          // Focused on open: the row was replaced by this field on the user's own
          // tap, so anything else costs a second tap before they can type.
          autoFocus
          type="text"
          maxLength={MAX_NAME}
          placeholder="Name these filters…"
          aria-label="Favourite name"
          value={mode.draft}
          onChange={(e) => { setError(null); setMode({ kind: "naming", draft: e.target.value }); }}
          onKeyDown={(e) => { if (e.key === "Escape") close(); }}
        />
        <button className="btn sm primary" type="submit">Save</button>
        <button className="btn sm ghost" type="button" onClick={close}>Cancel</button>
        {error && <span className="fav-err">{error}</span>}
      </form>
    );
  }

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
                  // Focused on open, as above.
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

  // Nothing saved and nothing worth saving: no row at all, so an untouched board grows
  // no furniture it has no use for.
  if (favorites.length === 0 && !canSave) return null;

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
      {canSave && (
        <button
          className="chip fav-act icon"
          aria-label="Save these filters as a favourite" title="Save these filters"
          onClick={beginNaming}
        >
          <Star size={13} aria-hidden="true" />
        </button>
      )}
      {favorites.length > 0 && (
        <button
          className="chip fav-act icon"
          aria-label="Edit favourites" title="Edit favourites"
          onClick={() => { setError(null); setMode({ kind: "editing", renaming: null }); }}
        >
          <Pencil size={13} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
