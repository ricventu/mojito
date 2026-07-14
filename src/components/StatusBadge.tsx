import { statusColorClass } from "@/lib/status";

/** Colored badge for a Linear lifecycle status (e.g. "To Code"). */
export default function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${statusColorClass(status)}`}>{status}</span>;
}
