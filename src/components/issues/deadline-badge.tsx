import { AlarmClock } from "lucide-react";
import { describeDeadline, type Deadline, type DeadlineState } from "@/lib/targets";

const styles: Record<DeadlineState, string> = {
  breached: "bg-red-100 text-red-700 ring-1 ring-red-200",
  due_soon: "bg-amber-100 text-amber-800",
  on_track: "bg-slate-100 text-slate-600",
  paused: "bg-sky-50 text-sky-700",
  met: "bg-emerald-50 text-emerald-700",
  met_late: "bg-amber-50 text-amber-800",
  stopped: "bg-slate-100 text-slate-500",
};

/** One deadline as a small badge, e.g. "First response overdue by 2 h". */
export function DeadlineBadge({ kind, deadline }: { kind: "first_response" | "resolution"; deadline: Deadline }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${styles[deadline.state]}`}
      data-state={deadline.state}
    >
      <AlarmClock className="h-3 w-3" aria-hidden />
      {describeDeadline(kind, deadline)}
    </span>
  );
}
