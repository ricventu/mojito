import { useCallback, useEffect, useRef, useState } from "react";
import { CornerLeftUp, Folder, FolderGit2 } from "lucide-react";
import type { DirList } from "@mojito/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api";
import { childPath, dirsHref, tildePath } from "@/lib/folderPicker";

interface Props {
  /** The Path field as typed; blank opens HOME. */
  start: string;
  /** The picked folder, written as the Path field writes it (`~/…` under HOME). */
  onPick(path: string): void;
  onCancel(): void;
}

const ROW = "flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent";

/**
 * Browse the server's folders and pick one for a project's Path (RIC-585). Opens at the typed
 * path; if that fails with nothing shown yet, opens HOME and keeps the error on screen. A failure
 * while a list is shown keeps that list. A late answer for a superseded request is dropped.
 */
export function FolderPicker({ start, onPick, onCancel }: Props) {
  const [list, setList] = useState<DirList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const shown = useRef<DirList | null>(null);

  const load = useCallback((path: string | null, keepError = false) => {
    const mine = ++seq.current;
    setLoading(true);
    apiFetch<DirList>(dirsHref(path)).then(
      (next) => {
        if (mine !== seq.current) return;
        shown.current = next;
        setList(next);
        if (!keepError) setError(null);
        setLoading(false);
      },
      (e: Error) => {
        if (mine !== seq.current) return;
        setError(e.message);
        // Nothing on screen yet: fall back to HOME, keeping this error visible.
        if (!shown.current && path !== null && path.trim()) load(null, true);
        else setLoading(false);
      },
    );
  }, []);

  // Opening only: `start` is the field's value when Browse was tapped.
  const [initial] = useState(start);
  useEffect(() => load(initial), [load, initial]);

  return (
    <div className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Choose folder</DialogTitle>
        <DialogDescription className="font-mono text-xs break-all">
          {list ? tildePath(list.path, list.home) : "…"}
        </DialogDescription>
      </DialogHeader>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="max-h-[50vh] overflow-y-auto">
        {!list ? (
          <p className="text-sm text-muted-foreground">{loading ? "Loading…" : "No folder to show."}</p>
        ) : (
          <ul className="flex flex-col">
            {list.parent !== null && (
              <li>
                <button type="button" className={ROW} disabled={loading} onClick={() => load(list.parent)}>
                  <CornerLeftUp size={16} className="shrink-0 text-muted-foreground" />
                  <span className="font-mono">..</span>
                </button>
              </li>
            )}
            {list.dirs.map((d) => (
              <li key={d.name}>
                <button
                  type="button"
                  className={ROW}
                  disabled={loading}
                  onClick={() => load(childPath(list.path, d.name))}
                >
                  {d.git ? (
                    <FolderGit2 size={16} className="shrink-0 text-muted-foreground" />
                  ) : (
                    <Folder size={16} className="shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{d.name}</span>
                  {d.git && <Badge variant="secondary">git</Badge>}
                </button>
              </li>
            ))}
            {list.dirs.length === 0 && <li className="px-2 py-3 text-sm text-muted-foreground">No folders here.</li>}
          </ul>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" disabled={!list || loading} onClick={() => list && onPick(tildePath(list.path, list.home))}>
          Use this folder
        </Button>
      </DialogFooter>
    </div>
  );
}
