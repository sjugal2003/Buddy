import type { IssueStatus, Sentiment, Urgency } from "@/lib/types";
import { sentimentLabels, statusLabels, urgencyLabels } from "@/lib/labels";

const base = "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium";

const urgencyStyles: Record<Urgency, string> = {
  critical: "bg-red-100 text-red-700 ring-1 ring-red-200",
  high: "bg-orange-100 text-orange-700",
  medium: "bg-yellow-100 text-yellow-800",
  low: "bg-slate-100 text-slate-600",
};

const sentimentStyles: Record<Sentiment, string> = {
  positive: "bg-emerald-100 text-emerald-700",
  neutral: "bg-slate-100 text-slate-600",
  negative: "bg-amber-100 text-amber-800",
  very_negative: "bg-red-100 text-red-700",
};

const statusStyles: Record<IssueStatus, string> = {
  new: "bg-brand-100 text-brand-700",
  open: "bg-sky-100 text-sky-700",
  in_progress: "bg-violet-100 text-violet-700",
  waiting_on_customer: "bg-slate-100 text-slate-600",
  escalated: "bg-red-600 text-white",
  resolved: "bg-emerald-100 text-emerald-700",
};

export function UrgencyBadge({ urgency }: { urgency: Urgency }) {
  return <span className={`${base} ${urgencyStyles[urgency]}`}>{urgencyLabels[urgency]}</span>;
}

export function SentimentBadge({ sentiment }: { sentiment: Sentiment }) {
  return <span className={`${base} ${sentimentStyles[sentiment]}`}>{sentimentLabels[sentiment]}</span>;
}

export function StatusBadge({ status }: { status: IssueStatus }) {
  return <span className={`${base} ${statusStyles[status]}`}>{statusLabels[status]}</span>;
}

export function Tag({ children }: { children: React.ReactNode }) {
  return <span className={`${base} bg-slate-100 text-slate-700`}>{children}</span>;
}
