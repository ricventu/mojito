import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SettingsBody, type Effort, type Model, type Settings } from "@mojito/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { LaunchOptions } from "@/components/sheets/LaunchOptions";
import { useSettings } from "@/hooks/useSettings";
import { apiJson } from "@/lib/api";
import { FALLBACK } from "@/lib/launch";
import { qk } from "@/lib/queryKeys";

/** The statuses a launch can start from, in board order. */
const STATUSES = ["Backlog", "Todo", "In Progress", "In Review"] as const;

function Form({ settings }: { settings: Settings }) {
  const qc = useQueryClient();
  const [defaults, setDefaults] = useState(settings.statusDefaults);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: SettingsBody) => apiJson<Settings>("/api/settings", "PUT", body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.settings });
      toast.success("Settings saved");
    },
    onError: (e) => setError(e.message),
  });

  const rowOf = (status: string) => defaults[status] ?? FALLBACK;
  const patch = (status: string, change: Partial<{ model: Model; effort: Effort }>) =>
    setDefaults((d) => ({ ...d, [status]: { ...(d[status] ?? FALLBACK), ...change } }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = SettingsBody.safeParse({ statusDefaults: defaults });
    if (!parsed.success) {
      setError("Invalid values.");
      return;
    }
    setError(null);
    save.mutate(parsed.data);
  }

  return (
    <form onSubmit={submit}>
      <CardContent className="flex flex-col gap-4">
        {STATUSES.map((status) => (
          <div key={status} className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{status}</span>
            <LaunchOptions
              idPrefix={`default-${status.replace(/\s+/g, "-").toLowerCase()}`}
              model={rowOf(status).model}
              effort={rowOf(status).effort}
              onModel={(model) => patch(status, { model })}
              onEffort={(effort) => patch(status, { effort })}
            />
          </div>
        ))}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
      <CardFooter className="mt-4">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </CardFooter>
    </form>
  );
}

/** Per-status model and effort, saved together with one PUT. */
export function DefaultsCard() {
  const settings = useSettings();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Defaults per status</CardTitle>
        <CardDescription>The model and effort a ticket in that status launches with.</CardDescription>
      </CardHeader>
      {settings.isError ? (
        <CardContent>
          <p className="text-sm text-destructive">{settings.error.message}</p>
        </CardContent>
      ) : !settings.data ? (
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading…</p>
        </CardContent>
      ) : (
        <Form settings={settings.data} />
      )}
    </Card>
  );
}
