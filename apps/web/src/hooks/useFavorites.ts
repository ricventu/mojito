import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Favorite, Settings } from "@mojito/shared";
import { useSettings } from "@/hooks/useSettings";
import { apiJson } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

const NONE: Favorite[] = [];

/**
 * The saved filter sets. `save` writes the whole list optimistically, then to the server; a
 * failure toasts and re-reads the settings rather than remembering a rollback.
 */
export function useFavorites(): { favorites: Favorite[]; save: (next: Favorite[]) => void } {
  const qc = useQueryClient();
  const favorites = useSettings().data?.favorites ?? NONE;

  const save = (next: Favorite[]) => {
    qc.setQueryData<Settings>(qk.settings, (s) => s && { ...s, favorites: next });
    apiJson<Settings>("/api/settings", "PUT", { favorites: next }).catch((e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Saving favourites failed");
      void qc.invalidateQueries({ queryKey: qk.settings });
    });
  };
  return { favorites, save };
}
