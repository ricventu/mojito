/** Replaces the row with the same id in place, or appends it. */
export function upsertById<T extends { id: string }>(list: T[] | undefined, row: T): T[] {
  const rows = list ?? [];
  const at = rows.findIndex((r) => r.id === row.id);
  if (at === -1) return [...rows, row];
  return rows.map((r, i) => (i === at ? row : r));
}

export function removeById<T extends { id: string }>(list: T[] | undefined, id: string): T[] {
  return (list ?? []).filter((r) => r.id !== id);
}
