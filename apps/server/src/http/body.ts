import type { Context } from "hono";
import type { z } from "zod";

export type Parsed<T> = { ok: true; data: T } | { ok: false; error: string };

/** One line naming each failing field, e.g. `ticket: Invalid string; model: Invalid option`. */
export function zodMessage(error: z.ZodError): string {
  return error.issues.map((i) => (i.path.length > 0 ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ");
}

/** The request's JSON body validated against `schema`; the error is ready for a 400. */
export async function parseBody<S extends z.ZodType>(c: Context, schema: S): Promise<Parsed<z.infer<S>>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false, error: "invalid JSON body" };
  }
  const result = schema.safeParse(raw);
  return result.success ? { ok: true, data: result.data } : { ok: false, error: zodMessage(result.error) };
}

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));
