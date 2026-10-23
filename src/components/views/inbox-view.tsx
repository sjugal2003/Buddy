"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { SentimentBadge, StatusBadge, UrgencyBadge } from "@/components/ui/badges";
import { inputClass, secondaryButton } from "@/components/ui/form";
import { useWorkspace } from "@/components/workspace/workspace-store";
import { IssueDetail } from "./issue-detail";
import { byPriority, isOpen } from "@/lib/analytics";
import { channelLabels, sentimentLabels, statusLabels, statusOrder, urgencyLabels, urgencyOrder } from "@/lib/labels";
import { timeAgo } from "@/lib/format";
import type { Channel, Issue, Sentiment } from "@/lib/types";

const FILTER_KEYS = ["q", "status", "urgency", "sentiment", "category", "team", "channel", "sort"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

function matches(issue: Issue, f: Record<FilterKey, string>) {
  if (f.q) {
    const q = f.q.toLowerCase();
    const text = `${issue.reference} ${issue.customerName} ${issue.subject} ${issue.message} ${issue.analysis.themes.join(" ")}`.toLowerCase();
    if (!text.includes(q)) return false;
  }
  if (f.status === "active" && !isOpen(issue)) return false;
  if (f.status && f.status !== "active" && f.status !== "all" && issue.status !== f.status) return false;
  if (f.urgency === "urgent" && !["critical", "high"].includes(issue.analysis.urgency)) return false;
  if (f.urgency && f.urgency !== "urgent" && issue.analysis.urgency !== f.urgency) return false;
  if (f.sentiment && issue.analysis.sentiment !== f.sentiment) return false;
  if (f.category && issue.analysis.categoryId !== f.category) return false;
  if (f.team === "unassigned" && issue.teamId) return false;
  if (f.team && f.team !== "unassigned" && issue.teamId !== f.team) return false;
  if (f.channel && issue.channel !== f.channel) return false;
  return true;
}

export function InboxView() {
  const { workspace, issues, teams, categories, now, categoryName, teamName } = useWorkspace();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [search, setSearch] = useState(params.get("q") ?? "");

  // Filters live in the address bar so a filtered view can be bookmarked.
  const filters = useMemo(() => {
    const f = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ""])) as Record<FilterKey, string>;
    if (!f.status) f.status = "active";
    return f;
  }, [params]);

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const visible = useMemo(() => {
    const list = issues.filter((i) => matches(i, filters));
    return filters.sort === "priority" ? [...list].sort(byPriority) : list;
  }, [issues, filters]);

  const selected = issues.find((i) => i.id === params.get("issue")) ?? null;
  const closeDetail = useCallback(() => setParam("issue", ""), [setParam]);
  const activeFilterCount = FILTER_KEYS.filter((k) => k !== "sort" && k !== "q" && filters[k] && !(k === "status" && filters[k] === "active")).length;

  const select = (key: FilterKey, label: string, options: [string, string][]) => (
    <select aria-label={label} className={inputClass} value={filters[key]} onChange={(e) => setParam(key, e.target.value)}>
      {options.map(([value, text]) => (
        <option key={value} value={value}>
          {text}
        </option>
      ))}
    </select>
  );

  return (
    <>
      <PageHeader
        title="Customer Issues Inbox"
        description={`${visible.length} of ${issues.length} issues for ${workspace.name}. Click an issue to see the analysis and update it.`}
      />

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="space-y-3 border-b border-slate-200 p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setParam("q", search.trim());
            }}
            className="relative"
          >
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                if (!e.target.value) setParam("q", "");
              }}
              onBlur={() => setParam("q", search.trim())}
              placeholder="Search by customer, reference, subject, message or theme"
              className={`${inputClass} pl-9`}
              aria-label="Search issues"
            />
          </form>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
            {select("status", "Status", [
              ["active", "All open"],
              ["all", "All statuses"],
              ...statusOrder.map((s) => [s, statusLabels[s]] as [string, string]),
            ])}
            {select("urgency", "Urgency", [
              ["", "Any urgency"],
              ["urgent", "Critical + high"],
              ...urgencyOrder.map((u) => [u, urgencyLabels[u]] as [string, string]),
            ])}
            {select("sentiment", "Sentiment", [
              ["", "Any sentiment"],
              ...(Object.keys(sentimentLabels) as Sentiment[]).map((s) => [s, sentimentLabels[s]] as [string, string]),
            ])}
            {select("category", "Category", [["", "Any category"], ...categories.map((c) => [c.id, c.name] as [string, string])])}
            {select("team", "Team", [["", "Any team"], ["unassigned", "Unassigned"], ...teams.map((t) => [t.id, t.name] as [string, string])])}
            {select("channel", "Channel", [
              ["", "Any channel"],
              ...(Object.keys(channelLabels) as Channel[]).map((c) => [c, channelLabels[c]] as [string, string]),
            ])}
            {select("sort", "Sort", [
              ["", "Newest first"],
              ["priority", "Most urgent first"],
            ])}
          </div>
          {(activeFilterCount > 0 || filters.q) && (
            <button
              className={`${secondaryButton} py-1 text-xs`}
              onClick={() => {
                setSearch("");
                router.replace(pathname, { scroll: false });
              }}
            >
              Clear filters
            </button>
          )}
        </div>

        {visible.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">No issues match these filters.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {visible.map((issue) => (
              <li key={issue.id}>
                <button
                  onClick={() => setParam("issue", issue.id)}
                  className="flex w-full flex-col gap-2 px-4 py-3 text-left hover:bg-slate-50 md:flex-row md:items-center md:gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-slate-900">{issue.subject}</p>
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">{issue.message}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      {issue.reference} · {issue.customerName} · {channelLabels[issue.channel]} · {categoryName(issue.analysis.categoryId)} · {timeAgo(issue.receivedAt, now)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5 md:w-80 md:justify-end">
                    <UrgencyBadge urgency={issue.analysis.urgency} />
                    <SentimentBadge sentiment={issue.analysis.sentiment} />
                    <StatusBadge status={issue.status} />
                    <span className={`text-xs ${issue.teamId ? "text-slate-500" : "font-medium text-brand-700"}`}>{teamName(issue.teamId)}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selected && <IssueDetail issue={selected} onClose={closeDetail} />}
    </>
  );
}
