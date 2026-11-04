import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { SessionMeta } from "@mojito/shared";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { splitLoose } from "@/lib/board";
import { qk } from "@/lib/queryKeys";
import { LooseSessionRow } from "./LooseSessionRow";

/** How long "Remove all" waits for the confirming second tap. */
const CONFIRM_MS = 4000;

/**
 * A project's loose sessions as one plain list at every width (a name needs the room): the live
 * ones first, then the ended ones under a heading that removes them all — two taps, since a
 * removed session can no longer be resumed.
 */
export function LooseSessions({ project, loose }: { project: string; loose: SessionMeta[] }) {
  const { live, ended } = splitLoose(loose);
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirming]);

  const removeAll = useMutation({
    mutationFn: async (ids: string[]) => {
      const results = await Promise.allSettled(
        ids.map((id) => apiFetch<unknown>(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" })),
      );
      return results.filter((r) => r.status === "rejected").length;
    },
    onSuccess: (failed, ids) => {
      if (failed > 0) toast.error(`${failed} of ${ids.length} sessions could not be removed`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Remove failed"),
    onSettled: () => {
      setConfirming(false);
      return qc.invalidateQueries({ queryKey: qk.sessions });
    },
  });

  return (
    <div className="flex flex-col gap-2">
      {live.length > 0 && (
        <ul className="flex flex-col gap-2">
          {live.map((s) => (
            <LooseSessionRow key={s.id} session={s} />
          ))}
        </ul>
      )}
      {ended.length > 0 && (
        <section aria-label={`Ended sessions in ${project}`} className="flex flex-col gap-2">
          <header className="flex items-center gap-2 pt-1">
            <h3 className="flex-1 text-xs font-medium text-muted-foreground">
              Ended <span className="tabular-nums">{ended.length}</span>
            </h3>
            <Button
              variant={confirming ? "destructive" : "ghost"}
              size="sm"
              className={confirming ? undefined : "text-muted-foreground"}
              disabled={removeAll.isPending}
              onClick={() => (confirming ? removeAll.mutate(ended.map((s) => s.id)) : setConfirming(true))}
            >
              <Trash2 size={14} />
              {confirming ? `Remove ${ended.length}?` : "Remove all"}
            </Button>
          </header>
          <ul className="flex flex-col gap-2">
            {ended.map((s) => (
              <LooseSessionRow key={s.id} session={s} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
