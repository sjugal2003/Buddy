import { Info } from "lucide-react";

/** A clear, honest note about what is demo-only on a page. */
export function DemoNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-6 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}
