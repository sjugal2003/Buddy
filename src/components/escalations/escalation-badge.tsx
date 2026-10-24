import { Siren } from "lucide-react";

/** The highest escalation level nobody has acknowledged yet. Nothing for 0. */
export function EscalationBadge({ level }: { level: number }) {
  if (level <= 0) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${
        level >= 2 ? "bg-red-600 text-white" : "bg-orange-100 text-orange-800 ring-1 ring-orange-200"
      }`}
      data-testid="escalation-badge"
    >
      <Siren className="h-3 w-3" aria-hidden />
      Escalated · level {level}
    </span>
  );
}
