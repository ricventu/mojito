import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * shadcn's class-name helper, and the only reason clsx/tailwind-merge are here: the
 * components under src/components/ui are shadcn sources, and every one of them takes a
 * `className` that has to be able to *override* its own defaults rather than merely be
 * appended to them — which is what twMerge does (last conflicting utility wins).
 *
 * Nothing outside src/components/ui needs it: the rest of the app styles itself with the
 * hand-written classes in globals.css, not with utilities.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
