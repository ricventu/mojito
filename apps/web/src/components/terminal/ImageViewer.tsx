import { useEffect, useState } from "react";
import { ExternalLink, Loader2, X } from "lucide-react";
import { CENTRED_ON_WIDE_CLASS } from "@/components/sheets/styles";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { apiBlob } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
  sessionId: string;
  /** The path as claude printed it: the server reads it from the session's directory. */
  path: string;
  onClose(): void;
}

type Loaded = { url: string } | { error: string } | null;

/**
 * An image path tapped in the terminal, over it rather than on a page of its own: the pty stays
 * attached and its size untouched. Full screen on a phone, a centred frame wider up. Fetched
 * with the token header and shown from an object URL, so the token never sits in a link. A tap
 * on the image flips between fitting the window and its actual size, scrolled.
 */
export function ImageViewer({ sessionId, path, onClose }: Props) {
  const [loaded, setLoaded] = useState<Loaded>(null);
  const [actualSize, setActualSize] = useState(false);
  const name = path.split("/").pop() ?? path;

  // The parent keys this component by path, so one load per mount; the URL dies with it.
  useEffect(() => {
    let live = true;
    let url: string | null = null;
    apiBlob(`/api/sessions/${encodeURIComponent(sessionId)}/image?path=${encodeURIComponent(path)}`).then(
      (blob) => {
        if (!live) return;
        url = URL.createObjectURL(blob);
        setLoaded({ url });
      },
      (e: unknown) => live && setLoaded({ error: e instanceof Error ? e.message : "Could not load the image" }),
    );
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [sessionId, path]);

  const url = loaded && "url" in loaded ? loaded.url : null;

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className={cn(
          "h-dvh gap-0 pt-[var(--sat)] pr-[var(--sar)] pb-[var(--sab)] pl-[var(--sal)]",
          CENTRED_ON_WIDE_CLASS,
          // A fixed frame wider up: a definite height is what lets "fit" scale the image to it.
          "sm:h-[90dvh] sm:max-w-6xl",
        )}
      >
        <div className="flex shrink-0 items-center gap-1 border-b py-2 pr-2 pl-4">
          <SheetTitle className="min-w-0 flex-1 truncate font-mono text-sm" title={path}>
            {name}
          </SheetTitle>
          <SheetDescription className="sr-only">{path}</SheetDescription>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Open in a new tab"
            title="Open in a new tab"
            disabled={!url}
            onClick={() => url && window.open(url, "_blank", "noopener,noreferrer")}
          >
            <ExternalLink size={16} />
          </Button>
          <SheetClose asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Close">
              <X size={16} />
            </Button>
          </SheetClose>
        </div>
        {/* `m-auto` rather than centring the box: centred content that overflows cannot be scrolled to its start. */}
        <div className="flex min-h-0 flex-1 overflow-auto">
          {url ? (
            <img
              src={url}
              alt={name}
              onClick={() => setActualSize(!actualSize)}
              className={cn(
                "m-auto",
                actualSize
                  ? "max-w-none cursor-zoom-out"
                  : "max-h-full max-w-full cursor-zoom-in object-contain",
              )}
            />
          ) : loaded && "error" in loaded ? (
            <p className="m-auto px-4 py-8 text-sm wrap-anywhere text-muted-foreground">{loaded.error}</p>
          ) : (
            <Loader2 size={20} className="m-auto my-8 animate-spin text-muted-foreground" aria-label="Loading" />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
