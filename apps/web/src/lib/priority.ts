import { isPriority, PRIORITIES, type PriorityInfo, type TicketSummary } from "@mojito/shared";

/** The ticket's Linear priority, 0-4; 0 when it carries none (an older peer) or a bad value. */
export const ticketPriority = (t: TicketSummary): number => (isPriority(t.priority) ? t.priority : 0);

/** Board order: Urgent 0 … Low 3, No priority 4 (last, as Linear sorts it). */
export const priorityRank = (priority: number): number => (priority === 0 ? 4 : priority - 1);

/** The name and url key of a priority; an invalid value reads as No priority. */
export const priorityInfo = (priority: number): PriorityInfo =>
  PRIORITIES.find((p) => p.value === priority) ?? (PRIORITIES.find((p) => p.value === 0) as PriorityInfo);
