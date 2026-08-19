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

/**
 * `list` with `s` in it, newest first — and the same list back when it is already
 * there.
 *
 * A launch answers with its SessionMeta before the session list has been refetched,
 * so the terminal url it opens names a session the list has never heard of. The page
 * corrects an unknown /session/<id> straight back to the board (see `missingSession`),
 * which is what made a fresh launch land on the list instead of in its own session.
 * Seeding the answer here closes that window; the refresh already in flight reconciles.
 */
export function withSession(list: SessionMeta[], s: SessionMeta): SessionMeta[] {
  return list.some((p) => p.id === s.id) ? list : [s, ...list];
}
