import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { DEFAULT_PROMPTS, type PromptKey, type Prompts, type Settings, type SettingsBody } from "@mojito/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSettings } from "@/hooks/useSettings";
import { apiJson } from "@/lib/api";
import { promptErrors } from "@/lib/prompts";
import { qk } from "@/lib/queryKeys";

const FIELDS: { key: PromptKey; label: string; hint: string }[] = [
  { key: "ticket", label: "Ticket session", hint: "Typed into claude when a ticket launches. {ticket} becomes the ticket id." },
  { key: "createTicket", label: "New ticket", hint: "Instructions for the agent that turns a note into a Linear issue." },
];

function Form({ settings }: { settings: Settings }) {
  const qc = useQueryClient();
  const [prompts, setPrompts] = useState<Prompts>(settings.prompts);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Shown only after a first Save, so a prompt is not flagged halfway through being retyped.
  const errors = submitted ? promptErrors(prompts) : {};

  const save = useMutation({
    mutationFn: (body: SettingsBody) => apiJson<Settings>("/api/settings", "PUT", body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.settings });
      toast.success("Prompts saved");
    },
    onError: (e) => setError(e.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    if (Object.keys(promptErrors(prompts)).length > 0) return;
    save.mutate({ prompts });
  }

  return (
    <form onSubmit={submit} noValidate>
      <CardContent className="flex flex-col gap-5">
        {FIELDS.map(({ key, label, hint }) => (
          <div key={key} className="flex flex-col gap-1.5">
            <div className="flex min-h-8 items-center gap-2">
              <Label htmlFor={`prompt-${key}`} className="flex-1">
                {label}
              </Label>
              {prompts[key] !== DEFAULT_PROMPTS[key] && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setPrompts((p) => ({ ...p, [key]: DEFAULT_PROMPTS[key] }))}>
                  <RotateCcw size={14} /> Default
                </Button>
              )}
            </div>
            <p id={`prompt-${key}-hint`} className="text-xs text-muted-foreground">
              {hint}
            </p>
            <Textarea
              id={`prompt-${key}`}
              value={prompts[key]}
              onChange={(e) => setPrompts((p) => ({ ...p, [key]: e.target.value }))}
              aria-invalid={errors[key] ? true : undefined}
              aria-describedby={errors[key] ? `prompt-${key}-hint prompt-${key}-error` : `prompt-${key}-hint`}
              spellCheck={false}
            />
            {errors[key] && (
              <p id={`prompt-${key}-error`} className="text-sm text-destructive">
                {errors[key]}
              </p>
            )}
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

/** The two prompts Mojito sends to Claude, editable; each starts from (and resets to) the shipped text. */
export function PromptsCard() {
  const settings = useSettings();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Prompts</CardTitle>
        <CardDescription>What Mojito tells Claude. Edits apply from the next launch or new ticket.</CardDescription>
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
