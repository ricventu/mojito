# Terminal header refactor (RIC-174)

## Problem

The terminal view's header runs off the right edge of a phone screen, and nothing
can scroll it back into view.

`.term-head` is a flex row whose text children keep the default `min-width: auto`,
so they refuse to shrink below their content width. On a 375px viewport the row
wants roughly:

| part | width |
|---|---|
| padding | 28 |
| back button | 32 |
| `RIC-174` | 55 |
| `· In Progress` | 100 |
| docs button | 36 |
| `●NEEDS INPUT` pill | 100 |
| `Kill` button | 48 |
| gaps (5 × 10) | 50 |
| **total** | **~449** |

`.term-root` is `position: fixed` and the mount effect forces
`overflow: hidden` on `html` and `body`, so the overflowing tail cannot be
reached by panning. The Kill/Dismiss button — the last item in the row — is
simply unreachable on a phone.

A second problem sits underneath: `.term-title` is its own full-width block with
no line clamp, so a long Linear title wraps to two or three lines. Together with
the header that is 8 of the ~13 terminal rows left when the virtual keyboard is
open, which is why the view currently hides all of its chrome while typing.

`.docs-head .name` already solves the same problem correctly with
`min-width: 0` + ellipsis. The terminal header is the odd one out.

## Goals

1. The header never overflows horizontally at any viewport width. Every control
   stays reachable.
2. The chrome costs one row instead of two.
3. The header reads as the same component family as `.docs-head` and the card
   list — same tokens, same truncation idiom, same badge.

Non-goals: changing what the header *does* (back, docs, state, kill), touching
the keyboard/fit machinery, or restyling any other view.

## Design

### Structure

The two chrome blocks (`<header class="term-head">` and the separate
`<div class="term-title">`) collapse into one row with three zones:

```
┌─────────────────────────────────────────────────┐
│ [back]  [ identity — flexible ]  [ actions ]    │
└─────────────────────────────────────────────────┘
   flex:none   flex:1, min-width:0    flex:none
```

- **back** — unchanged 32px chevron, never shrinks.
- **identity** — ticket id, Linear status, ticket title. Owns all the slack and
  absorbs all the truncation.
- **actions** — docs, state badge, kill. Never shrinks, so it is always on
  screen. This is the whole fix for the unreachable Kill button.

Within the identity zone the id is the anchor and never truncates (`flex: none`);
the title takes the remaining space and ellipsizes (`min-width: 0; flex: 1;
overflow: hidden; text-overflow: ellipsis; white-space: nowrap`).

Rendered:

```
narrow (≤480px)
┌──────────────────────────────────┐
│ ‹  RIC-174  Refactor head…  ● 📄 ✕│
└──────────────────────────────────┘

wide
┌───────────────────────────────────────────────────────────────────┐
│ ‹  RIC-174 · In Progress  Refactor header…  ●NEEDS INPUT  📄  Kill │
└───────────────────────────────────────────────────────────────────┘
```

### Narrow adaptations

Three things shed weight below 480px, in order of how little they are missed:

1. **Linear status name** (`· In Progress`) hides. It is the least load-bearing
   label in the row and it is already on the card the user tapped to get here.
2. **State badge** drops its text and keeps the coloured, glowing dot. The colour
   already carries the state; the word is redundant at a glance.
3. **Kill/Dismiss** drops to a `✕` glyph, still `danger`-red while the session is
   active. It keeps its `aria-label` and `title`, and the existing `confirm()`
   still guards the action, so a mis-tap costs one tap to undo.

At 360px the fixed parts then total ~250px, leaving ~110px of title before the
ellipsis. Nothing overflows.

Each of these is a CSS media query over markup that renders both forms — no
JS breakpoint state, nothing to keep in sync with the fit machinery.

### Keyboard behaviour

Unchanged. All chrome still hides while the virtual keyboard is open. The
one-row header would only cost the TUI ~2 rows, but the existing hide was a
deliberate fix for Claude's input line disappearing, and this ticket is not the
place to relitigate it. `kbdOpen` keeps gating the header exactly as today.

### Pure presenter

The identity zone's "which of these fields do we actually have" logic currently
lives inline in JSX as `&&` guards. Custom sessions have no `ticket` and no
`launchStatus`; shell sessions have neither plus no model; sidecars written
before `title` existed can have it `undefined` at runtime despite the type. That
is real branching and it belongs in a tested unit.

`src/lib/terminalHeader.ts`:

```ts
export interface TerminalHeadModel {
  id: string;         // "" when absent
  status: string;     // "" when absent
  title: string;      // "" when absent
  killLabel: string;  // "Kill" | "Dismiss"
  killDanger: boolean;
}

export function terminalHeadModel(session: SessionMeta): TerminalHeadModel
```

It trims and guards every field the way `terminalTabTitle` already does, and it
owns the `active` predicate that currently sits loose in the component. The
component becomes a straight render of the model with no conditionals beyond
"is this string empty".

If a session has no id and no title (a bare shell), the identity zone renders
nothing and the actions simply sit next to the back button — an empty flexible
zone collapses on its own, no special case needed.

### StateBadge

`StateBadge` renders its label as a bare text node, which CSS cannot hide. Wrap
it in `<span className="lbl">`. Purely additive: the badge looks identical
everywhere it is already used (`SessionList`), and the terminal header can now
hide the label at narrow widths with
`.term-head .badge .lbl { display: none }` plus symmetric padding.

## Testing

`vitest` runs in the `node` environment over `tests/**/*.test.ts` — there is no
React testing library in this project, and the established pattern is to push
logic into `src/lib/*.ts` and unit-test that. So:

- `tests/lib/terminalHeader.test.ts` covers `terminalHeadModel`: a full ticket
  session, a custom session (no id, no status), a shell session, a sidecar with
  `title` undefined, whitespace-only fields, and both kill labels across all six
  `SessionState` values.
- Layout and the media queries are CSS. They are verified by reading the diff
  and by the reviewer, not by a test — consistent with how every other view in
  this repo is covered.

Regression guard: `npx tsc --noEmit && npx vitest run` must stay green (593
tests at branch point).

## Files

| file | change |
|---|---|
| `src/lib/terminalHeader.ts` | new — pure presenter |
| `tests/lib/terminalHeader.test.ts` | new — its tests |
| `src/components/TerminalView.tsx` | header JSX collapses to one row, uses the presenter |
| `src/components/StateBadge.tsx` | wrap label in `.lbl` |
| `src/app/globals.css` | `.term-head` zones + narrow media query; drop `.term-title` |
