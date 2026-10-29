import { z } from "zod";
import { EFFORTS, MODELS } from "./models";
import { PromptsBody } from "./prompts";

export const LaunchTicketBody = z.object({
  kind: z.literal("ticket"),
  ticket: z.string().regex(/^[A-Z][A-Z0-9]*-\d+$/),
  model: z.enum(MODELS),
  effort: z.enum(EFFORTS),
});
export type LaunchTicketBody = z.infer<typeof LaunchTicketBody>;

export const LaunchFreeBody = z
  .object({
    kind: z.enum(["claude", "shell"]),
    project: z.string().nullable(),
    model: z.enum(MODELS).optional(),
    effort: z.enum(EFFORTS).optional(),
  })
  .superRefine((body, ctx) => {
    if (body.kind !== "claude") return;
    for (const field of ["model", "effort"] as const) {
      if (body[field] === undefined) {
        ctx.addIssue({ code: "custom", path: [field], message: `${field} is required for a claude session` });
      }
    }
  });
export type LaunchFreeBody = z.infer<typeof LaunchFreeBody>;

export const LaunchBody = z.discriminatedUnion("kind", [LaunchTicketBody, LaunchFreeBody]);
export type LaunchBody = z.infer<typeof LaunchBody>;

export const ProjectBody = z.object({
  name: z.string().min(1),
  /** Absolute, or under the server's home: `~` or `~/…` (expanded by the server, stored as typed). */
  path: z.string().regex(/^(\/|~(\/|$))/),
  teamKey: z.string().regex(/^[A-Z][A-Z0-9]*$/),
});
export type ProjectBody = z.infer<typeof ProjectBody>;

/** Names are unique ignoring case, so a favourite is told apart by what the chip shows. */
export const FavoritesBody = z
  .array(z.object({ name: z.string().trim().min(1).max(60), search: z.string().max(2000) }))
  .max(50)
  .superRefine((list, ctx) => {
    const seen = new Set<string>();
    for (const { name } of list) {
      const key = name.toLowerCase();
      if (seen.has(key)) ctx.addIssue({ code: "custom", message: `duplicate favourite name: ${name}` });
      seen.add(key);
    }
  });

/** A partial update: each key sent replaces that part of the settings, a key left out keeps it. */
export const SettingsBody = z.object({
  statusDefaults: z.record(z.string(), z.object({ model: z.enum(MODELS), effort: z.enum(EFFORTS) })).optional(),
  prompts: PromptsBody.optional(),
  favorites: FavoritesBody.optional(),
});
export type SettingsBody = z.infer<typeof SettingsBody>;

/** Only `hidden` can be changed on a session; anything else is refused. */
export const SessionPatchBody = z.strictObject({ hidden: z.boolean() });
export type SessionPatchBody = z.infer<typeof SessionPatchBody>;

export const StatusBody = z.object({ status: z.string().min(1) });
export type StatusBody = z.infer<typeof StatusBody>;
