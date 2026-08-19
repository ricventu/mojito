import { apiFetch } from "./client";

/** What to say when the server refused but gave no reason of its own. */
const FALLBACK = "could not close the session";

/**
 * Ask the server to close and forget a session. Returns `null` when it did, and the
 * reason it did not otherwise.
 *
 * A refusal is a normal answer, not an exception: the server removes a session only
 * once claude has actually exited (closeSession has no force path), so "claude is
 * still running" comes back whenever it would not leave. Both call sites used to
 * ignore the status entirely, which made a refused dismiss look exactly like a
 * successful one — the button appeared to do nothing at all.
 */
export async function dismissSession(token: string, id: string): Promise<string | null> {
  const res = await apiFetch(token, `/api/sessions/${id}`, { method: "DELETE" });
  if (res.ok) return null;
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error !== "") return body.error;
  } catch {
    /* not json: the fallback says the useful half anyway */
  }
  return FALLBACK;
}
