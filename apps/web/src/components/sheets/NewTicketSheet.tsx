import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, X } from "lucide-react";
import { toast } from "sonner";
import type { TaskRecord } from "@mojito/shared";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useProjects } from "@/hooks/useProjects";
import { apiFetch } from "@/lib/api";
import { IMAGE_TYPES, dragHasFiles, pastedImages, validateImages } from "@/lib/images";
import { qk } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { SHEET_CONTENT_CLASS } from "./styles";

interface Props {
  /** Preselected project (the sheet was opened from its section). */
  project?: string;
  onClose: () => void;
}

/** A note and some images; an agent task writes the ticket, so the sheet takes no title. */
export function NewTicketSheet({ project: preselected, onClose }: Props) {
  const projects = useProjects();
  const qc = useQueryClient();
  const [project, setProject] = useState(preselected ?? "");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  // dragenter/dragleave fire again for every child the pointer crosses (the label, the textarea):
  // a bare leave turned the ring off over each one. Counted, only the last leave ends the drag.
  const dragDepth = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);

  /** Adds images when the whole set stays within the limits; otherwise says why and adds none. */
  const addFiles = (incoming: File[]) => {
    if (incoming.length === 0) return;
    const next = [...files, ...incoming];
    const check = validateImages(next);
    if (!check.ok) {
      toast.error(check.error);
      return;
    }
    setFiles(next);
  };

  const create = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append("project", project);
      form.append("note", note.trim());
      for (const f of files) form.append("images", f);
      return apiFetch<TaskRecord>("/api/tasks", { method: "POST", body: form });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.tasks });
      toast.success("Creating the ticket");
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Create failed"),
  });

  // A paste with text is the textarea's: Word and spreadsheets put a picture of the text on the
  // clipboard beside it, which must not turn up as an image (pastedImages).
  const onPaste = (e: ClipboardEvent) => {
    const pasted = pastedImages(e.clipboardData);
    if (pasted.length === 0) return;
    e.preventDefault();
    addFiles(pasted);
  };
  // Only a drag of files is ours; a drag of text is left to the textarea, which drops it in place.
  const onDragEnter = (e: DragEvent) => {
    if (!dragHasFiles(e.dataTransfer.types)) return;
    dragDepth.current += 1;
    setDragging(true);
  };
  const onDragLeave = (e: DragEvent) => {
    if (!dragHasFiles(e.dataTransfer.types)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };
  const onDrop = (e: DragEvent) => {
    dragDepth.current = 0;
    setDragging(false);
    if (!dragHasFiles(e.dataTransfer.types)) return;
    e.preventDefault();
    // Every file, not only images: a dropped PDF is refused with a reason rather than ignored.
    addFiles(Array.from(e.dataTransfer.files));
  };

  const canCreate = project !== "" && note.trim() !== "" && !create.isPending;

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className={SHEET_CONTENT_CLASS}>
        <SheetHeader className="pr-12">
          <SheetTitle>New ticket</SheetTitle>
          <SheetDescription>Write a note: Claude drafts the title and description.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-ticket-project">Project</Label>
            <Select value={project} onValueChange={setProject}>
              <SelectTrigger id="new-ticket-project" className="w-full">
                <SelectValue placeholder="Choose a project" />
              </SelectTrigger>
              <SelectContent>
                {(projects.data ?? []).map((p) => (
                  <SelectItem key={p.name} value={p.name}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div
            className={cn("flex flex-col gap-1.5 rounded-lg", dragging && "ring-2 ring-ring")}
            onDragEnter={onDragEnter}
            onDragOver={(e) => {
              if (dragHasFiles(e.dataTransfer.types)) e.preventDefault();
            }}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            <Label htmlFor="new-ticket-note">Note</Label>
            <Textarea
              id="new-ticket-note"
              rows={6}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onPaste={onPaste}
              placeholder="What needs doing? You can paste or drop images."
            />
          </div>

          <div className="flex flex-col gap-2">
            <input
              ref={input}
              type="file"
              multiple
              accept={IMAGE_TYPES.join(",")}
              className="hidden"
              onChange={(e) => {
                addFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => input.current?.click()}>
              <ImagePlus size={14} /> Add images
            </Button>
            {files.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="relative size-16 overflow-hidden rounded-md border">
                    <img src={previews[i]} alt={f.name} className="size-full object-cover" />
                    <button
                      type="button"
                      aria-label={`Remove ${f.name}`}
                      onClick={() => setFiles(files.filter((_, j) => j !== i))}
                      className="absolute top-0.5 right-0.5 rounded-full bg-background/90 p-0.5 shadow outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <X size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Button disabled={!canCreate} onClick={() => create.mutate()}>
            {create.isPending ? "Creating…" : "Create"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
