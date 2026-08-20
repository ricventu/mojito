/** One choice in a select: the value that travels, and the text the user reads. */
export interface SelectOption {
  value: string;
  label: string;
}

/** The label for a value, falling back to the value itself when it is not among the options. */
export function optionLabel(value: string, options: readonly SelectOption[]): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

/**
 * What a multi-select's closed trigger says.
 *
 * Nothing selected reads as the unfiltered state (`emptyLabel`) rather than as an empty
 * field, because that is what an empty project filter *means* — every project, not
 * "nothing chosen yet". Beyond one selection the first label plus a count, since the
 * trigger is one line wide on a phone and a comma list would truncate mid-name; the
 * open panel is where the full set is readable.
 *
 * Values are shown in the order given, and one not among the options still names
 * itself — a project the map has dropped must stay visible while it is filtering.
 */
export function multiSelectSummary(
  values: readonly string[],
  options: readonly SelectOption[],
  emptyLabel: string,
): string {
  if (values.length === 0) return emptyLabel;
  const first = optionLabel(values[0], options);
  return values.length === 1 ? first : `${first} +${values.length - 1}`;
}
