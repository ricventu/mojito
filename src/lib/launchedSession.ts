import type { SessionMeta } from "@/server/types";

/**
 * The three launch bodies of `POST /api/sessions` all answer 201 with the registered
 * `SessionMeta`, which is what lets a sheet jump straight into the session it just started
 * instead of dropping the user back on the list. Anything without an `id` is unusable as a
 * terminal target — an older server, a proxy that rewrote the body — so it reads as null and
 * the caller falls back to merely closing the sheet.
 */
export function launchedSession(payload: unknown): SessionMeta | null {
  if (!payload || typeof payload !== "object") return null;
  const { id } = payload as { id?: unknown };
  return typeof id === "string" && id !== "" ? (payload as SessionMeta) : null;
}
