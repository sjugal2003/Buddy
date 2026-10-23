"use client";

import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { DemoNotice } from "@/components/ui/notice";
import { Field, Toggle, inputClass, primaryButton, secondaryButton } from "@/components/ui/form";
import { useWorkspace } from "@/components/workspace/workspace-store";
import { channelLabels, intentLabels, sentimentLabels, urgencyLabels } from "@/lib/labels";
import { findMatchingRule, ruleMatches } from "@/lib/routing";
import { isOpen } from "@/lib/analytics";
import type { RoutingRule, RuleCondition, RuleField } from "@/lib/types";

const fieldLabels: Record<RuleField, string> = {
  category: "Category is",
  urgency: "Urgency is",
  sentiment: "Sentiment is",
  intent: "Intent is",
  channel: "Channel is",
  keyword: "Message contains",
};

function useValueOptions() {
  const { categories } = useWorkspace();
  return (field: RuleField): [string, string][] | null => {
    switch (field) {
      case "category":
        return categories.map((c) => [c.id, c.name]);
      case "urgency":
        return Object.entries(urgencyLabels);
      case "sentiment":
        return Object.entries(sentimentLabels);
      case "intent":
        return Object.entries(intentLabels);
      case "channel":
        return Object.entries(channelLabels);
      case "keyword":
        return null;
    }
  };
}

function RuleEditor({ rule, onSave, onCancel }: { rule: RoutingRule; onSave: (r: RoutingRule) => void; onCancel: () => void }) {
  const { teams } = useWorkspace();
  const valueOptions = useValueOptions();
  const [draft, setDraft] = useState(rule);
  const updateCondition = (index: number, change: Partial<RuleCondition>) =>
    setDraft((d) => ({ ...d, conditions: d.conditions.map((c, i) => (i === index ? { ...c, ...change } : c)) }));

  const valid = draft.name.trim() && draft.conditions.length > 0 && draft.conditions.every((c) => c.value.trim());

  return (
    <div className="space-y-4 rounded-lg border border-brand-200 bg-brand-50/40 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Rule name">
          <input className={inputClass} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </Field>
        <Field label="Send matching issues to">
          <select className={inputClass} value={draft.teamId} onChange={(e) => setDraft({ ...draft, teamId: e.target.value })}>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Match when">
        <select className={inputClass} value={draft.match} onChange={(e) => setDraft({ ...draft, match: e.target.value as RoutingRule["match"] })}>
          <option value="any">Any condition is true</option>
          <option value="all">All conditions are true</option>
        </select>
      </Field>
      <div className="space-y-2">
        {draft.conditions.map((condition, index) => {
          const options = valueOptions(condition.field);
          return (
            <div key={index} className="flex flex-col gap-2 sm:flex-row">
              <select
                aria-label="Condition field"
                className={`${inputClass} sm:w-48`}
                value={condition.field}
                onChange={(e) => {
                  const field = e.target.value as RuleField;
                  updateCondition(index, { field, value: valueOptions(field)?.[0]?.[0] ?? "" });
                }}
              >
                {Object.entries(fieldLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              {options ? (
                <select aria-label="Condition value" className={inputClass} value={condition.value} onChange={(e) => updateCondition(index, { value: e.target.value })}>
                  {options.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  aria-label="Keyword"
                  className={inputClass}
                  placeholder="e.g. refund"
                  value={condition.value}
                  onChange={(e) => updateCondition(index, { value: e.target.value })}
                />
              )}
              <button
                className={secondaryButton}
                aria-label="Remove condition"
                onClick={() => setDraft((d) => ({ ...d, conditions: d.conditions.filter((_, i) => i !== index) }))}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          );
        })}
        <button
          className={`${secondaryButton} text-xs`}
          onClick={() => setDraft((d) => ({ ...d, conditions: [...d.conditions, { field: "keyword", value: "" }] }))}
        >
          <Plus className="h-3.5 w-3.5" /> Add condition
        </button>
      </div>
      <div className="flex gap-2">
        <button className={primaryButton} disabled={!valid} onClick={() => onSave({ ...draft, name: draft.name.trim() })}>
          Save rule
        </button>
        <button className={secondaryButton} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function RoutingView() {
  const { workspace, rules, setRules, issues, teams, teamName, categoryName, assignIssue } = useWorkspace();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newRule, setNewRule] = useState<RoutingRule | null>(null);
  const [testIssueId, setTestIssueId] = useState(issues[0]?.id ?? "");
  const [routedMessage, setRoutedMessage] = useState<string | null>(null);
  const valueLabel = useValueOptions();

  const matchCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const issue of issues) {
      const rule = findMatchingRule(rules, issue);
      if (rule) counts.set(rule.id, (counts.get(rule.id) ?? 0) + 1);
    }
    return counts;
  }, [issues, rules]);

  const unassignedOpen = issues.filter((i) => isOpen(i) && !i.teamId);
  const testIssue = issues.find((i) => i.id === testIssueId);
  const testRule = testIssue ? findMatchingRule(rules, testIssue) : null;

  const move = (index: number, delta: number) => {
    const next = [...rules];
    const [rule] = next.splice(index, 1);
    next.splice(index + delta, 0, rule);
    setRules(next);
  };

  const describe = (c: RuleCondition) => {
    const label = valueLabel(c.field)?.find(([v]) => v === c.value)?.[1] ?? `"${c.value}"`;
    return `${fieldLabels[c.field].toLowerCase()} ${label}`;
  };

  const routeUnassigned = () => {
    let routed = 0;
    for (const issue of unassignedOpen) {
      const rule = findMatchingRule(rules, issue);
      if (rule) {
        assignIssue(issue.id, rule.teamId);
        routed += 1;
      }
    }
    setRoutedMessage(`Routed ${routed} of ${unassignedOpen.length} unassigned issues.`);
  };

  return (
    <>
      <PageHeader
        title="Team Routing Rules"
        description="Rules are checked from top to bottom. The first rule that matches decides which team gets the issue."
        actions={
          <button
            className={primaryButton}
            onClick={() => {
              setEditingId(null);
              setNewRule({
                id: `rr_local_${Date.now()}`,
                workspaceId: workspace.id,
                name: "",
                enabled: true,
                match: "any",
                conditions: [{ field: "keyword", value: "" }],
                teamId: teams[0].id,
              });
            }}
          >
            <Plus className="h-4 w-4" /> New rule
          </button>
        }
      />
      <DemoNotice>
        The rule logic is real and runs on the demo issues. Your changes are saved in this browser only, until accounts and a
        database are added in Phase 2.
      </DemoNotice>

      {newRule && (
        <div className="mb-6">
          <RuleEditor
            rule={newRule}
            onCancel={() => setNewRule(null)}
            onSave={(rule) => {
              setRules([...rules, rule]);
              setNewRule(null);
            }}
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {rules.map((rule, index) =>
            editingId === rule.id ? (
              <RuleEditor
                key={rule.id}
                rule={rule}
                onCancel={() => setEditingId(null)}
                onSave={(updated) => {
                  setRules(rules.map((r) => (r.id === updated.id ? updated : r)));
                  setEditingId(null);
                }}
              />
            ) : (
              <div key={rule.id} className={`rounded-xl border bg-white p-4 shadow-sm ${rule.enabled ? "border-slate-200" : "border-dashed border-slate-300 opacity-70"}`}>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900">{rule.name}</p>
                    <p className="mt-1 text-xs text-slate-600">
                      If {rule.match === "all" ? "all" : "any"} of: {rule.conditions.map(describe).join(rule.match === "all" ? " and " : " or ")}
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      → <span className="font-medium text-slate-900">{teamName(rule.teamId)}</span>
                      <span className="text-slate-400"> · first match for {matchCounts.get(rule.id) ?? 0} current issues</span>
                    </p>
                  </div>
                  <Toggle
                    checked={rule.enabled}
                    label={`Enable ${rule.name}`}
                    onChange={(enabled) => setRules(rules.map((r) => (r.id === rule.id ? { ...r, enabled } : r)))}
                  />
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5 pl-9">
                  <button className={`${secondaryButton} px-2 py-1 text-xs`} disabled={index === 0} onClick={() => move(index, -1)} aria-label="Move up">
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    className={`${secondaryButton} px-2 py-1 text-xs`}
                    disabled={index === rules.length - 1}
                    onClick={() => move(index, 1)}
                    aria-label="Move down"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button className={`${secondaryButton} px-2 py-1 text-xs`} onClick={() => setEditingId(rule.id)}>
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </button>
                  <button
                    className={`${secondaryButton} px-2 py-1 text-xs text-red-600`}
                    onClick={() => {
                      if (window.confirm(`Delete the rule "${rule.name}"?`)) setRules(rules.filter((r) => r.id !== rule.id));
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                </div>
              </div>
            ),
          )}
          {rules.length === 0 && <p className="text-sm text-slate-500">No rules yet. New issues will stay unassigned.</p>}
        </div>

        <div className="space-y-6">
          <Card title="Test the rules" description="Pick an issue to see where the rules would send it">
            <select className={inputClass} value={testIssueId} onChange={(e) => setTestIssueId(e.target.value)} aria-label="Issue to test">
              {issues.slice(0, 40).map((i) => (
                <option key={i.id} value={i.id}>
                  {i.reference}: {i.subject}
                </option>
              ))}
            </select>
            {testIssue && (
              <div className="mt-3 space-y-1 text-xs text-slate-600">
                <p>
                  Category: {categoryName(testIssue.analysis.categoryId)} · Urgency: {urgencyLabels[testIssue.analysis.urgency]} · Intent:{" "}
                  {intentLabels[testIssue.analysis.intent]}
                </p>
                <p className="pt-2 text-sm">
                  {testRule ? (
                    <>
                      Matches <strong>{testRule.name}</strong> → <strong>{teamName(testRule.teamId)}</strong>
                    </>
                  ) : (
                    <span className="text-amber-700">No rule matches. It would stay unassigned.</span>
                  )}
                </p>
                <p className="text-slate-400">
                  Other rules that also match: {rules.filter((r) => r !== testRule && ruleMatches(r, testIssue)).map((r) => r.name).join(", ") || "none"}
                </p>
              </div>
            )}
          </Card>

          <Card title="Unassigned issues" description="Open issues with no team yet">
            <p className="text-3xl font-semibold tabular-nums">{unassignedOpen.length}</p>
            <button className={`${primaryButton} mt-3 w-full`} disabled={unassignedOpen.length === 0} onClick={routeUnassigned}>
              Route them with these rules
            </button>
            {routedMessage && <p className="mt-2 text-xs text-emerald-700">{routedMessage}</p>}
          </Card>
        </div>
      </div>
    </>
  );
}
