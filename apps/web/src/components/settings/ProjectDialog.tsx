import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ProjectBody, type ProjectRow } from "@mojito/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiJson } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

/** Italian text for the field a client-side check rejected; the server's own messages are shown as they come. */
const FIELD_ERRORS: Record<string, string> = {
  name: "Il nome è obbligatorio.",
  path: "Il percorso deve essere assoluto (inizia con / o ~/).",
  teamKey: "La chiave del team va scritta in maiuscolo, ad esempio RIC.",
};

interface Props {
  /** The project being edited; `null` adds a new one. */
  project: ProjectRow | null;
  onClose: () => void;
}

function Form({ project, onClose }: Props) {
  const qc = useQueryClient();
  const [name, setName] = useState(project?.name ?? "");
  const [path, setPath] = useState(project?.path ?? "");
  const [teamKey, setTeamKey] = useState(project?.teamKey ?? "");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: ProjectBody) =>
      project
        ? apiJson<ProjectRow>(`/api/projects/${encodeURIComponent(project.name)}`, "PUT", body)
        : apiJson<ProjectRow>("/api/projects", "POST", body),
    onSuccess: () => {
      // A project change also moves which tickets the server fetches, so the board is stale too.
      void qc.invalidateQueries({ queryKey: qk.projects });
      void qc.invalidateQueries({ queryKey: qk.tickets });
      onClose();
    },
    onError: (e) => setError(e.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = ProjectBody.safeParse({ name: name.trim(), path: path.trim(), teamKey: teamKey.trim() });
    if (!parsed.success) {
      const field = String(parsed.error.issues[0]?.path[0] ?? "");
      setError(FIELD_ERRORS[field] ?? "Dati non validi.");
      return;
    }
    setError(null);
    save.mutate(parsed.data);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{project ? "Modifica progetto" : "Nuovo progetto"}</DialogTitle>
        <DialogDescription>Il nome è quello del progetto su Linear; il percorso è la cartella del repo.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="project-name">Nome</Label>
        <Input id="project-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="project-path">Percorso</Label>
        <Input
          id="project-path"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="~/code/progetto"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="font-mono"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="project-team">Team key</Label>
        <Input
          id="project-team"
          value={teamKey}
          onChange={(e) => setTeamKey(e.target.value.toUpperCase())}
          placeholder="RIC"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          className="font-mono"
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Annulla
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Salvataggio…" : "Salva"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Add or edit one project. The form is remounted per opening, so it never shows the last one's fields. */
export function ProjectDialog({ project, open, onClose }: Props & { open: boolean }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>{open && <Form project={project} onClose={onClose} />}</DialogContent>
    </Dialog>
  );
}
