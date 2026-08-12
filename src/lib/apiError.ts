/**
 * The message to show for a failed API response: the route's own JSON `{ error }` when
 * there is one, else the caller's fallback with the status code.
 *
 * Every route in this app answers JSON, so a bare `res.text()` put a raw
 * `{"error":"duplicate"}` in front of the user. The fallback covers the bodies that are
 * not ours — a proxy's HTML error page, or nothing at all.
 */
export async function apiError(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    if (body?.error) return String(body.error);
  } catch { /* not JSON, or no body — fall through to the status code */ }
  return `${fallback} (${res.status})`;
}
