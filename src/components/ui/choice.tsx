"use client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";

/**
 * A short fixed list — model, effort — as a shadcn Select.
 *
 * No search box, unlike ui/combobox: these lists are a handful of values that never
 * grow, and a search field above five options is in the way of the tap rather than a
 * shortcut to it. The launch sheet's base branch used to be here on the grounds that a
 * branch list is short in practice; with the remote-tracking branches in it, it is not, and
 * it moved to the searchable one.
 *
 * `label` names the trigger for assistive tech: these sit next to a `.lbl` span rather
 * than inside a <label>, since the trigger is a <button> and buttons are not labelable.
 */
export function Choice(
  { label, value, onChange, options }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: readonly string[];
  },
) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent>
        {options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
