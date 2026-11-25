import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import type { Command, CommandResult, CommandRunBody, PeersAnswer, SessionMeta } from "@mojito/shared";
import { ApiError, apiJson } from "@/lib/api";
import { commandMessage, commandRunError, commandRunPath } from "@/lib/commands";
import { sessionHref } from "@/lib/host";
import { launchErrorAction, withLaunched } from "@/lib/launch";
import { withPeerSession } from "@/lib/peers";
import { qk } from "@/lib/queryKeys";

/** One run from the sheet: the command, where, and the sheet's picks. */
export interface CommandRun {
  command: Command;
  /** A peer's name; null = this instance. */
  host: string | null;
  options: Omit<CommandRunBody, "prompt">;
}

/**
 * Runs a project's command from its sheet (RIC-622): `POST …/commands/:id/run` with the command
 * itself, here or on a peer through the relay, then opens its session's terminal. The answered
 * session goes into the cache first, so the terminal has its row at once. A 409 that names the
 * session holding the id is a toast with an Open action.
 */
export function useRunCommand(project: string, onDone: () => void) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  return useMutation<CommandResult, Error, CommandRun>({
    mutationFn: ({ command, host, options }) =>
      apiJson<CommandResult>(commandRunPath(host, project, command.id), "POST", { prompt: command.prompt, ...options } satisfies CommandRunBody),
    onSuccess: ({ session, alreadyOpen }, { command, host }) => {
      onDone();
      if (host === null) {
        qc.setQueryData<SessionMeta[]>(qk.sessions, (list) => withLaunched(list, session));
        void qc.invalidateQueries({ queryKey: qk.sessions });
      } else {
        qc.setQueryData<PeersAnswer>(qk.peers, (answer) => withPeerSession(answer, host, session));
      }
      toast.info(commandMessage(command.name, alreadyOpen, host));
      navigate(sessionHref(host, session.id));
    },
    onError: (e, { command, host }) => {
      const message = commandRunError(command.name, e, host);
      const action = e instanceof ApiError ? launchErrorAction(e) : undefined;
      if (action?.kind === "open") {
        const href = sessionHref(host, action.sessionId);
        toast.error(message, { action: { label: "Open", onClick: () => navigate(href) } });
      } else {
        toast.error(message);
      }
    },
  });
}
