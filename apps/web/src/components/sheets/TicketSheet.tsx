import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, SquareTerminal, Trash2 } from "lucide-react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import type { Effort, Model, SessionMeta, Settings, TicketSummary } from "@mojito/shared";
import { StateBadge } from "@/components/StateBadge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useProjects } from "@/hooks/useProjects";
import { useSessions } from "@/hooks/useSessions";
import { useSettings } from "@/hooks/useSettings";
import { ApiError, apiFetch, apiJson } from "@/lib/api";
import { sessionForTicket } from "@/lib/board";
import { initialLaunchOptions, launchErrorAction } from "@/lib/launch";
import { qk } from "@/lib/queryKeys";
import { LaunchOptions } from "./LaunchOptions";
import { SHEET_CONTENT_CLASS } from "./styles";

const sessionPath = (id: string) => `/session/${encodeURIComponent(id)}`;
const errorMessage = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/** The ticket's status, changeable among the states its team has (Linear's own list). */
function StatusField({ ticket, teamKey }: { ticket: TicketSummary; teamKey: string | undefined }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState(ticket.statusName);
  const states = useQuery({
    queryKey: ["ticket-states", teamKey],
    queryFn: () => apiFetch<string[]>(`/api/tickets/states?team=${encodeURIComponent(teamKey ?? "")}`),
    enabled: teamKey !== undefined,
    staleTime: 5 * 60_000,
  });
  const move = useMutation({
    mutationFn: (next: string) =>
      apiJson<unknown>(`/api/tickets/${encodeURIComponent(ticket.identifier)}/status`, "POST", { status: next }),
    onError: (e, _next, previous) => {
      setStatus(previous as string);
      toast.error(errorMessage(e, "Status change failed"));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.tickets }),
    onMutate: () => status,
  });

  if (!teamKey || !states.data) return null;
  const options = states.data.includes(status) ? states.data : [status, ...states.data];

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="ticket-status">Status</Label>
      <Select
        value={status}
        onValueChange={(next) => {
          setStatus(next);
          move.mutate(next);
        }}
      >
        <SelectTrigger id="ticket-status" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((s) => (
            <SelectItem key={s} value={s}>
              {s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Model, effort and brainstorming, then Launch. Disabled while the request is in flight: a double tap is one POST. */
function LaunchForm({ ticket, settings, onClose }: { ticket: TicketSummary; settings: Settings; onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const initial = initialLaunchOptions(ticket, settings);
  const [model, setModel] = useState<Model>(initial.model);
  const [effort, setEffort] = useState<Effort>(initial.effort);
  const [brainstorming, setBrainstorming] = useState(initial.brainstorming);

  const launch = useMutation({
    mutationFn: () =>
      apiJson<{ session: SessionMeta; warning?: string }>("/api/sessions", "POST", {
        kind: "ticket",
        ticket: ticket.identifier,
        model,
        effort,
        brainstorming,
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
      <LaunchOptions idPrefix="ticket" model={model} effort={effort} onModel={setModel} onEffort={setEffort} />
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="ticket-brainstorming">Brainstorming</Label>
        <Switch id="ticket-brainstorming" checked={brainstorming} onCheckedChange={setBrainstorming} />
      </div>
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
          <Trash2 size={16} /> Kill
        </Button>
      </div>
    </div>
  );
}

interface Props {
  ticket: TicketSummary;
  onClose: () => void;
}

/** The ticket's detail sheet: status, and either its live session or the form that starts one. */
export function TicketSheet({ ticket, onClose }: Props) {
  const sessions = useSessions();
  const projects = useProjects();
  const settings = useSettings();
  const session = sessionForTicket(sessions.data ?? [], ticket.identifier);
  const live = session !== null && session.state !== "ended";
  const teamKey = projects.data?.find((p) => p.name === ticket.project)?.teamKey;

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className={SHEET_CONTENT_CLASS}>
        <SheetHeader className="pr-12">
          <a
            href={ticket.url}
            target="_blank"
            rel="noreferrer"
            className="w-fit font-mono text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            {ticket.identifier}
          </a>
          <SheetTitle className="leading-snug break-words">{ticket.title}</SheetTitle>
          <SheetDescription className="sr-only">Status and session launch for {ticket.identifier}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 px-4">
          <StatusField ticket={ticket} teamKey={teamKey} />
          {live ? (
            <LiveSession ticket={ticket} session={session} onClose={onClose} />
          ) : settings.data ? (
            <LaunchForm ticket={ticket} settings={settings.data} onClose={onClose} />
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
