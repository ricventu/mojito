import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

/**
 * Tailwind exists here for one thing only: the shadcn components under
 * src/components/ui, which come styled in utilities. The rest of the app is the
 * hand-written CSS in globals.css and uses no utility classes at all.
 *
 * The colour names below are the ones shadcn's sources ask for (bg-popover,
 * bg-accent, border-input, ring-ring …), each pointing at a `--ui-*` variable that
 * globals.css defines in terms of Mojito's own design tokens. That indirection is what
 * lets a component be pasted in from shadcn essentially unedited and still come out
 * looking like the rest of the app — and it is why the vars are named `--ui-*` rather
 * than shadcn's bare `--accent`, which Mojito already owns as its brand lime.
 *
 * Bare `var(--…)` values, not hsl triples: Mojito's tokens are hex, so the
 * `bg-accent/50` opacity syntax does not apply — no shadcn source used here needs it.
 */
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "var(--ui-bg)",
        foreground: "var(--ui-fg)",
        popover: { DEFAULT: "var(--ui-popover)", foreground: "var(--ui-fg)" },
        accent: { DEFAULT: "var(--ui-hover)", foreground: "var(--ui-fg)" },
        muted: { DEFAULT: "var(--ui-muted)", foreground: "var(--ui-muted-fg)" },
        input: "var(--ui-border)",
        ring: "var(--ui-ring)",
        border: "var(--ui-border)",
        brand: "var(--accent)",
      },
      // `border` with no colour utility (shadcn writes it that way) has to land on the
      // token border, not Tailwind's default grey.
      borderColor: { DEFAULT: "var(--ui-border)" },
      borderRadius: { md: "var(--r-sm)", lg: "var(--r)" },
    },
  },
  plugins: [animate],
} satisfies Config;
