import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitGraph, Play, Power, SquareTerminal } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import type { Effort, Model, SessionMeta, Settings, TicketSummary } from "@mojito/shared";
import { StateBadge } from "@/components/StateBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useProjects } from "@/hooks/useProjects";
import { useSessions } from "@/hooks/useSessions";
import { useSettings } from "@/hooks/useSettings";
import { ApiError, apiFetch, apiJson } from "@/lib/api";
import { sessionForTicket } from "@/lib/board";
import { gitHref } from "@/lib/git/url";
import { launchErrorAction, launchOptions, type LaunchPicks } from "@/lib/launch";
import { qk } from "@/lib/queryKeys";
import { safeHref } from "@/lib/url";
import { LaunchOptions } from "./LaunchOptions";
import { SHEET_CONTENT_CLASS } from "./styles";

const sessionPath = (id: string) => `/session/${encodeURIComponent(id)}`;
const errorMessage = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/**
 * The ticket's status as a pill in the header; tapping it moves the ticket among its team's states
 * (Linear's own list). `teamKey` is undefined while projects load and null for a project that is
 * not mapped; until the states are in, the pill is a plain badge — and when they cannot be had,
 * a line beside it says why, with a retry where one can help.
 */
function StatusPill({
  ticket,
  status,
  teamKey,
  onMove,
}: {
  ticket: TicketSummary;
  status: string;
  teamKey: string | null | undefined;
  onMove: (status: string | null) => void;
}) {
  const qc = useQueryClient();
  const states = useQuery({
    queryKey: ["ticket-states", teamKey],
    queryFn: () => apiFetch<string[]>(`/api/tickets/states?team=${encodeURIComponent(teamKey ?? "")}`),
    enabled: !!teamKey,
    staleTime: 5 * 60_000,
  });
  const move = useMutation({
    mutationFn: (next: string) =>
      apiJson<unknown>(`/api/tickets/${encodeURIComponent(ticket.identifier)}/status`, "POST", { status: next }),
    onMutate: (next) => onMove(next),
    onSuccess: (_data, next) => toast.success(`${ticket.identifier} → ${next}`),
    onError: (e) => {
      onMove(null);
      toast.error(errorMessage(e, "Status change failed"));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.tickets }),
  });

  if (!teamKey || !states.data || states.data.length === 0) {
    const why =
      teamKey === null
        ? `${ticket.project ?? "this ticket"} is not a mapped project`
        : states.isError
          ? `states did not load: ${errorMessage(states.error, "error")}`
          : states.data?.length === 0
            ? `team ${teamKey} has no states`
            : null;
    return (
      <>
        <Badge variant="secondary">{status}</Badge>
        {why && (
          <span className="text-xs text-muted-foreground">
            Read-only: {why}
            {states.isError && (
              <>
                {" · "}
                <button
                  type="button"
                  className="underline underline-offset-2 disabled:opacity-50"
                  disabled={states.isFetching}
                  onClick={() => void states.refetch()}
                >
                  Retry
                </button>
              </>
            )}
          </span>
        )}
      </>
    );
  }
  const options = states.data.includes(status) ? states.data : [status, ...states.data];

  return (
    <Select value={status} disabled={move.isPending} onValueChange={(next) => move.mutate(next)}>
      <SelectTrigger
        aria-label="Status"
        className="h-auto gap-1 rounded-full border-transparent bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground shadow-none hover:bg-secondary/80 dark:bg-secondary dark:hover:bg-secondary/80 [&_svg]:size-3"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        {options.map((s) => (
          <SelectItem key={s} value={s}>
            {s}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Model and effort, then Launch. Disabled while the request is in flight: a double tap is one POST.
 * Both start from the defaults of the status shown in the header, and keep following it — a status
 * moved in this sheet brings its own defaults — until the human picks one by hand.
 */
function LaunchForm({
  ticket,
  status,
  settings,
  onClose,
}: {
  ticket: TicketSummary;
  status: string;
  settings: Settings;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [picks, setPicks] = useState<LaunchPicks>({});
  const { model, effort } = launchOptions(status, settings, picks);

  const launch = useMutation({
    mutationFn: () =>
      apiJson<{ session: SessionMeta; warning?: string }>("/api/sessions", "POST", {
        kind: "ticket",
        ticket: ticket.identifier,
        model,
        effort,
      }),
    onSuccess: ({ session, warning }) => {
      void qc.invalidateQueries({ queryKey: qk.sessions });
      void qc.invalidateQueries({ queryKey: qk.tickets });
      if (warning) toast.warning(warning);
      onClose();
      navigate(sessionPath(session.id));
    },
    onError: (e) => {
      const action = e instanceof ApiError ? launchErrorAction(e) : { kind: "toast" as const, message: errorMessage(e, "Launch failed") };
      if (action.kind === "open") {
        onClose();
        navigate(sessionPath(action.sessionId));
      } else {
        toast.error(action.message);
      }
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <LaunchOptions
        idPrefix="ticket"
        model={model}
        effort={effort}
        onModel={(m) => setPicks((p) => ({ ...p, model: m }))}
        onEffort={(e) => setPicks((p) => ({ ...p, effort: e }))}
      />
      <Button disabled={launch.isPending} onClick={() => launch.mutate()}>
        <Play size={16} /> {launch.isPending ? "Launching…" : "Launch"}
      </Button>
    </div>
  );
}

/** A live session: open its terminal, or kill it (after a confirm). */
function LiveSession({ ticket, session, onClose }: { ticket: TicketSummary; session: SessionMeta; onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const kill = useMutation({
    mutationFn: () => apiFetch<unknown>(`/api/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Session ended");
      void qc.invalidateQueries({ queryKey: qk.sessions });
    },
    // A 409 means claude would not leave: the session is untouched, its terminal is the way in.
    onError: (e) => toast.error(errorMessage(e, "Kill failed")),
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Session</span>
        <StateBadge state={session.state} />
      </div>
      <div className="flex gap-2">
        <Button
          className="flex-1"
          onClick={() => {
            onClose();
            navigate(sessionPath(session.id));
          }}
        >
          <SquareTerminal size={16} /> Open terminal
        </Button>
        <Button
          variant="outline"
          disabled={kill.isPending}
          onClick={() => {
            if (window.confirm(`Kill the ${ticket.identifier} session?`)) kill.mutate();
          }}
        >
          <Power size={16} /> Kill
        </Button>
      </div>
    </div>
  );
}

interface Props {
  ticket: TicketSummary;
  onClose: () => void;
}

/** The ticket's detail sheet: its status in the header, then either its live session or the form that starts one. */
export function TicketSheet({ ticket, onClose }: Props) {
  const sessions = useSessions();
  const projects = useProjects();
  const settings = useSettings();
  const session = sessionForTicket(sessions.data ?? [], ticket.identifier);
  const live = session !== null && session.state !== "ended";
  const teamKey = projects.data ? (projects.data.find((p) => p.name === ticket.project)?.teamKey ?? null) : undefined;
  // A move made here, shown at once and kept: Linear answers the refetch a beat later.
  const [movedTo, setMovedTo] = useState<string | null>(null);
  const status = movedTo ?? ticket.statusName;

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className={SHEET_CONTENT_CLASS}>
        <SheetHeader className="pr-12">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={safeHref(ticket.url)}
              target="_blank"
              rel="noreferrer"
              className="w-fit font-mono text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              {ticket.identifier}
            </a>
            <StatusPill ticket={ticket} status={status} teamKey={teamKey} onMove={setMovedTo} />
          </div>
          <SheetTitle className="leading-snug break-words">{ticket.title}</SheetTitle>
          <SheetDescription className="sr-only">Status and session launch for {ticket.identifier}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 px-4">
          {ticket.project && (
            <Button asChild variant="outline">
              <Link to={gitHref(ticket.project, { ticket: ticket.identifier })} onClick={onClose}>
                <GitGraph size={16} /> Git
              </Link>
            </Button>
          )}
          {live ? (
            <LiveSession ticket={ticket} session={session} onClose={onClose} />
          ) : settings.data ? (
            <LaunchForm ticket={ticket} status={status} settings={settings.data} onClose={onClose} />
          ) : (
            <p className="text-sm text-muted-foreground">
              {settings.error ? errorMessage(settings.error, "Settings unavailable") : "Loading…"}
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
