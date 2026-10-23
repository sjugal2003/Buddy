import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

/** Shows a change in complaint volume. Up is bad, so it is red. */
export function TrendPill({ change, previous }: { change: number; previous: number }) {
  if (previous === 0 && change > 0) {
    return <span className="inline-flex items-center gap-0.5 text-xs font-medium text-red-600">New</span>;
  }
  const pct = Math.round(change * 100);
  if (Math.abs(pct) < 5) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-slate-500">
        <Minus className="h-3 w-3" aria-hidden /> Flat
      </span>
    );
  }
  const up = pct > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${up ? "text-red-600" : "text-emerald-600"}`}>
      <Icon className="h-3 w-3" aria-hidden />
      {up ? "+" : ""}
      {pct}%
    </span>
  );
}
