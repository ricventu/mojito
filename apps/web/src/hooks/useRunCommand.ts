import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import type { Command, CommandResult } from "@mojito/shared";
import { ApiError, apiJson } from "@/lib/api";
import { commandMessage } from "@/lib/commands";
import { launchErrorAction } from "@/lib/launch";
import { qk } from "@/lib/queryKeys";

/**
 * Runs a project's command (`POST /api/projects/:name/commands/:id`): opens its session's
 * terminal. A 409 that names the session holding the id is a toast with an Open action.
 */
export function useRunCommand(project: string) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  return useMutation<CommandResult, Error, Command>({
    mutationFn: (command) =>
      apiJson<CommandResult>(
        `/api/projects/${encodeURIComponent(project)}/commands/${encodeURIComponent(command.id)}`,
        "POST",
      ),
    onSuccess: (result, command) => {
      void qc.invalidateQueries({ queryKey: qk.sessions });
      toast.info(commandMessage(command.name, result.alreadyOpen));
      navigate(`/session/${encodeURIComponent(result.session.id)}`);
    },
    onError: (e, command) => {
      const action = e instanceof ApiError ? launchErrorAction(e) : undefined;
      if (action?.kind === "open") {
        const id = action.sessionId;
        toast.error(`${command.name} failed: ${e.message}`, {
          action: { label: "Open", onClick: () => navigate(`/session/${encodeURIComponent(id)}`) },
        });
      } else {
        toast.error(`${command.name} failed: ${e.message}`);
      }
    },
  });
}
