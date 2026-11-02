import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { SessionMeta } from "@mojito/shared";
import { apiJson } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

/**
 * Resume an ended session of this instance (`POST /api/sessions/:id/resume`): claude starts again
 * on its own conversation, under the same id. `onResumed` gets the new row.
 */
export function useResume(id: string, onResumed?: (session: SessionMeta) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiJson<{ session: SessionMeta }>(`/api/sessions/${encodeURIComponent(id)}/resume`, "POST"),
    onSuccess: ({ session }) => {
      void qc.invalidateQueries({ queryKey: qk.sessions });
      onResumed?.(session);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Resume failed"),
  });
}
