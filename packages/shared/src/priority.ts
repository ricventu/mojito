import { z } from "zod";

/** Linear's priority values: 0 none, 1 urgent … 4 low. */
export type PriorityValue = 0 | 1 | 2 | 3 | 4;

/** The url's word for a priority (the board's `priority=` filter). */
export type PriorityKey = "urgent" | "high" | "medium" | "low" | "none";

export interface PriorityInfo {
  value: PriorityValue;
  key: PriorityKey;
  name: string;
}

/** Every priority in board order: Urgent first, No priority last (Linear's own sort). */
export const PRIORITIES: readonly PriorityInfo[] = [
  { value: 1, key: "urgent", name: "Urgent" },
  { value: 2, key: "high", name: "High" },
  { value: 3, key: "medium", name: "Medium" },
  { value: 4, key: "low", name: "Low" },
  { value: 0, key: "none", name: "No priority" },
];

/** Whether `value` is one of Linear's priorities: an integer 0-4. */
export const isPriority = (value: unknown): value is PriorityValue =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 4;

export const PriorityBody = z.object({ priority: z.number().int().min(0).max(4) });
export type PriorityBody = z.infer<typeof PriorityBody>;
