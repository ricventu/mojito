import { useEffect } from "react";
import { useRouteError } from "react-router";
import { chunkErrorAction, sessionStore } from "@/lib/chunkReload";

// Decided once per error object: the decision also writes the reload guard, and StrictMode
// renders (and runs state initialisers) twice — a second decision would read the guard the
// first just set and call it a loop.
const decided = new WeakMap<object, "reload" | "show">();

function decide(error: unknown): "reload" | "show" {
  if (typeof error !== "object" || error === null) return chunkErrorAction(error, sessionStore());
  let action = decided.get(error);
  if (!action) {
    action = chunkErrorAction(error, sessionStore());
    decided.set(error, action);
  }
  return action;
}

/**
 * The router's error boundary. A lazy chunk that vanished in a deploy reloads the page once
 * (chunkReload.ts); any other error, or a chunk still missing after that reload, is shown with
 * a way back to the board — a full load, so a stale client picks up the new build.
 */
export function RouteError() {
  const error = useRouteError();
  const action = decide(error);

  useEffect(() => {
    if (action === "reload") window.location.reload();
  }, [action]);

  if (action === "reload") return null;
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-4 pt-[var(--sat)] pb-[var(--sab)]">
      <h1 className="text-base font-semibold">Qualcosa è andato storto</h1>
      <p className="text-sm break-words text-muted-foreground">
        {error instanceof Error ? error.message : "Errore imprevisto nel caricare la pagina."}
      </p>
      <a href="/" className="text-sm font-medium underline underline-offset-2">
        Torna alla board
      </a>
    </div>
  );
}
