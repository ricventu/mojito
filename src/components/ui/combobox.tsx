"use client";
// The searchable selects, shadcn's Popover + Command combination (its "combobox"
// recipe) in two shapes: one value, or many. Both are used for the project field —
// the list of projects is the one option list here long enough to need typing.
import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./command";
import { multiSelectSummary, optionLabel, type SelectOption } from "@/lib/selectSummary";
import { cn } from "@/lib/cn";

export type { SelectOption };

// Same shape as ui/select's trigger — the two kinds of select sit side by side in the
// sheets, so they have to be the same control to the eye. focus-visible, not focus:
// Radix returns focus here when the panel closes, and a ring left behind after a tap
// reads as "still open".
const TRIGGER = cn(
  "flex h-[42px] w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2",
  "text-left text-sm font-medium text-foreground",
  "focus:outline-none focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-[var(--accent-soft)]",
);

// Matches the trigger, so the panel reads as the field opening rather than as a menu
// floating next to it. Radix publishes the measurement as a CSS variable.
const PANEL = "w-[var(--radix-popover-trigger-width)] min-w-[220px]";

function Panel(
  { search, empty, children }: { search: string; empty: string; children: React.ReactNode },
) {
  return (
    <Command>
      <CommandInput placeholder={search} />
      <CommandList>
        <CommandEmpty>{empty}</CommandEmpty>
        <CommandGroup>{children}</CommandGroup>
      </CommandList>
    </Command>
  );
}

/**
 * A single-value select with a search field.
 *
 * `modal` on the Popover is not decoration: these open inside .sheet, whose backdrop
 * closes the whole sheet on click. A non-modal popover lets the dismissing tap through
 * to that backdrop, so picking a project by tapping outside the list would take the
 * sheet with it.
 */
export function Combobox(
  { options, value, onChange, label, searchLabel = "Search…", emptyLabel = "No match." }: {
    options: readonly SelectOption[];
    value: string;
    onChange: (value: string) => void;
    /** Names the trigger for assistive tech — these sit next to a .lbl, not inside a <label>. */
    label: string;
    searchLabel?: string;
    emptyLabel?: string;
  },
) {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger className={TRIGGER} aria-label={label}>
        <span className="truncate">{optionLabel(value, options)}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className={PANEL}>
        <Panel search={searchLabel} empty={emptyLabel}>
          {options.map((o) => (
            <CommandItem
              key={o.value}
              // cmdk filters on this, not on the item's children: without it a value
              // like the "General" sentinel would be what the user has to type.
              value={o.label}
              onSelect={() => { onChange(o.value); setOpen(false); }}
            >
              <Check className={cn("h-4 w-4 shrink-0 text-brand", o.value === value ? "opacity-100" : "opacity-0")} />
              <span className="truncate">{o.label}</span>
            </CommandItem>
          ))}
        </Panel>
      </PopoverContent>
    </Popover>
  );
}

/**
 * A multi-value select with a search field: every selected value narrows, none means
 * no narrowing at all (see multiSelectSummary).
 *
 * Selecting does not close the panel — the whole point of a multi-select is a run of
 * choices — so the way out is the same tap outside that a single one uses, plus the
 * clear row that appears once something is selected.
 */
export function MultiCombobox(
  { options, values, onChange, label, emptyState, searchLabel = "Search…", emptyLabel = "No match.", clearLabel }: {
    options: readonly SelectOption[];
    values: readonly string[];
    onChange: (values: string[]) => void;
    label: string;
    /** What the trigger says when nothing is selected, i.e. what "no filter" looks like. */
    emptyState: string;
    searchLabel?: string;
    emptyLabel?: string;
    clearLabel: string;
  },
) {
  const [open, setOpen] = React.useState(false);
  const toggle = (value: string) =>
    onChange(values.includes(value) ? values.filter((v) => v !== value) : [...values, value]);
  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger className={TRIGGER} aria-label={label}>
        <span className={cn("truncate", values.length === 0 && "text-muted-foreground")}>
          {multiSelectSummary(values, options, emptyState)}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className={PANEL}>
        <Panel search={searchLabel} empty={emptyLabel}>
          {options.map((o) => (
            <CommandItem key={o.value} value={o.label} onSelect={() => toggle(o.value)}>
              <Check
                className={cn("h-4 w-4 shrink-0 text-brand", values.includes(o.value) ? "opacity-100" : "opacity-0")}
              />
              <span className="truncate">{o.label}</span>
            </CommandItem>
          ))}
        </Panel>
        {/* Outside the CommandList on purpose: a clear row that the search box could
            filter away would strand a typed-into panel with no way back. */}
        {values.length > 0 && (
          <button
            type="button"
            className="w-full border-t border-input px-3 py-2 text-left text-sm text-muted-foreground hover:text-foreground"
            onClick={() => onChange([])}
          >
            {clearLabel}
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
