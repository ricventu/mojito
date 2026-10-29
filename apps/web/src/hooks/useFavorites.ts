import { useMutation, useMutationState, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Favorite, Settings } from "@mojito/shared";
import { useSettings } from "@/hooks/useSettings";
import { apiJson } from "@/lib/api";
import { currentFavorites } from "@/lib/favorites";
import { favoritesMutationKey, qk } from "@/lib/queryKeys";

const NONE: Favorite[] = [];
const PENDING = { mutationKey: favoritesMutationKey, status: "pending" } as const;

/** The lists of the favourites writes not yet answered, oldest first, from every component. */
function queuedLists(qc: QueryClient): Favorite[][] {
  return qc
    .getMutationCache()
    .findAll(PENDING)
    .map((m) => m.state.variables as Favorite[]);
}

export interface Favorites {
  favorites: Favorite[];
  /** Settings have loaded. Until then there is no list to edit, and `save` refuses. */
  ready: boolean;
  /**
   * Applies `update` to the current list (the newest queued write, else the cache) and
   * queues the PUT. Resolves `true` once the server has the list; `false` when nothing was
   * sent (settings not loaded, or no change) or the PUT failed, which has been toasted.
   */
  save(update: (current: Favorite[]) => Favorite[]): Promise<boolean>;
}

/**
 * The saved filter sets. Writes queue in one mutation scope, so the PUTs land in order, and
 * each is computed from the write queued before it rather than from a list a refetch may
 * have replaced. What is shown is the newest queued list, then the server's answer. A
 * failure toasts; once the queue drains the settings are re-read either way.
 */
export function useFavorites(): Favorites {
  const qc = useQueryClient();
  const cached = useSettings().data?.favorites;
  const queued = useMutationState({ filters: PENDING, select: (m) => m.state.variables as Favorite[] });

  const write = useMutation({
    mutationKey: favoritesMutationKey,
    scope: { id: "favorites" },
    mutationFn: (favorites: Favorite[]) => apiJson<Settings>("/api/settings", "PUT", { favorites }),
    onSuccess: (settings) => qc.setQueryData(qk.settings, settings),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Saving favourites failed"),
    // This write is still counted: 1 means it is the last one queued.
    onSettled: () => {
      if (qc.isMutating({ mutationKey: favoritesMutationKey }) === 1) {
        void qc.invalidateQueries({ queryKey: qk.settings });
      }
    },
  });

  const save = (update: (current: Favorite[]) => Favorite[]) => {
    const current = currentFavorites(qc.getQueryData<Settings>(qk.settings)?.favorites, queuedLists(qc));
    if (current === undefined) return Promise.resolve(false);
    const next = update(current);
    if (next === current) return Promise.resolve(false);
    return write.mutateAsync(next).then(
      () => true,
      () => false,
    );
  };

  return { favorites: currentFavorites(cached, queued) ?? NONE, ready: cached !== undefined, save };
}
