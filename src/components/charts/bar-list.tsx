/** A simple, accessible horizontal bar list. */
export function BarList({
  items,
  color = "var(--color-brand-500)",
}: {
  items: { label: string; value: number; color?: string; suffix?: string }[];
  color?: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item.label}>
          <div className="mb-1 flex justify-between gap-2 text-xs">
            <span className="truncate text-slate-700">{item.label}</span>
            <span className="shrink-0 tabular-nums text-slate-500">
              {item.value}
              {item.suffix}
            </span>
          </div>
          <div className="h-2 rounded-full bg-slate-100">
            <div
              className="h-2 rounded-full"
              style={{ width: `${(item.value / max) * 100}%`, background: item.color ?? color }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
