"use client";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./client";
import type { FilterFavorite } from "./filterFavorites";

export interface FilterFavorites {
  favorites: FilterFavorite[];
  /** Store the whole list. `false` means it did not land — the caller says so. */
  save: (next: FilterFavorite[]) => Promise<boolean>;
}

const PATH = "/api/config/filter-favorites";

/**
 * The board's saved filter favourites, server-side so the phone and the desktop see
 * one set (the installed PWA has its own localStorage container, which is exactly what
 * a client-only store would have split them across).
 *
 * `save` is optimistic and then reconciles against the response: every edit the row
 * offers is a whole-list PUT, and the reorder arrows are meant to be tapped several
 * times in a row — a round trip before each repaint would make them feel broken. A
 * failed save re-reads the server rather than restoring a remembered list, because the
 * server is the source of truth and a second client may have moved it on.
 */
export function useFilterFavorites(token: string): FilterFavorites {
  const [favorites, setFavorites] = useState<FilterFavorite[]>([]);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiFetch(token, PATH);
      const body: { favorites?: FilterFavorite[] } = res.ok ? await res.json() : {};
      setFavorites(body.favorites ?? []);
    } catch {
      // An unreachable server costs the board its favourites row, not the board.
      setFavorites([]);
    }
  }, [token]);

  useEffect(() => { refresh(); }, [refresh]);

  const save = useCallback(async (next: FilterFavorite[]): Promise<boolean> => {
    setFavorites(next);
    try {
      const res = await apiFetch(token, PATH, {
        method: "PUT",
        body: JSON.stringify({ favorites: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const body: { favorites?: FilterFavorite[] } = await res.json();
      setFavorites(body.favorites ?? next);
      return true;
    } catch {
      await refresh();
      return false;
    }
  }, [token, refresh]);

  return { favorites, save };
}
