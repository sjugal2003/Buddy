"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { DemoNotice } from "@/components/ui/notice";
import { Field, Toggle, inputClass, primaryButton, secondaryButton } from "@/components/ui/form";
import { useWorkspace } from "@/components/workspace/workspace-store";
import { hoursBetween, isOpen } from "@/lib/analytics";
import { urgencyLabels, urgencyOrder } from "@/lib/labels";
import type { AutomationSettings, NotificationRule, Urgency } from "@/lib/types";

const scheduleLabels: Record<AutomationSettings["analysisSchedule"], string> = {
  every_15_min: "Every 15 minutes",
  hourly: "Every hour",
  every_6_hours: "Every 6 hours",
  daily: "Once a day",
};

const triggerLabels: Record<NotificationRule["trigger"], string> = {
  new_critical: "A new critical issue arrives",
  escalated: "An issue is escalated",
  daily_digest: "Daily digest (8:00)",
  weekly_report: "Weekly management report (Monday 9:00)",
};

export function AutomationView() {
  const { automation } = useWorkspace();
  const [savedNote, setSavedNote] = useState(false);
  // Re-create the editor whenever the stored settings change (for example when
  // saved changes are loaded from this browser), so the form starts from them.
  return <AutomationEditor key={JSON.stringify(automation)} savedNote={savedNote} onSaved={() => setSavedNote(true)} />;
}

function AutomationEditor({ savedNote, onSaved }: { savedNote: boolean; onSaved: () => void }) {
  const { automation, setAutomation, issues, now } = useWorkspace();
  const [draft, setDraft] = useState(automation);
  const dirty = JSON.stringify(draft) !== JSON.stringify(automation);

  // Real calculation on the demo data: which open issues each rule would catch right now.
  const wouldEscalate = useMemo(
    () =>
      Object.fromEntries(
        draft.escalationRules.map((rule) => [
          rule.id,
          issues.filter(
            (i) =>
              isOpen(i) &&
              i.status !== "escalated" &&
              i.analysis.urgency === rule.urgency &&
              hoursBetween(i.receivedAt, now.toISOString()) > rule.afterHours,
          ).length,
        ]),
      ),
    [draft.escalationRules, issues, now],
  );

  const updateEscalation = (id: string, change: Partial<AutomationSettings["escalationRules"][number]>) =>
    setDraft((d) => ({ ...d, escalationRules: d.escalationRules.map((r) => (r.id === id ? { ...r, ...change } : r)) }));
  const updateNotification = (id: string, change: Partial<NotificationRule>) =>
    setDraft((d) => ({ ...d, notificationRules: d.notificationRules.map((r) => (r.id === id ? { ...r, ...change } : r)) }));

  return (
    <>
      <PageHeader
        title="Automation Settings"
        description="When messages are analysed, when unresolved issues are escalated, and who gets notified."
        actions={
          <>
            <button className={secondaryButton} disabled={!dirty} onClick={() => setDraft(automation)}>
              Discard
            </button>
            <button
              className={primaryButton}
              disabled={!dirty}
              onClick={() => {
                setAutomation(draft);
                onSaved();
              }}
            >
              Save in this browser
            </button>
          </>
        }
      />
      <DemoNotice>
        <strong>Preview only.</strong> Nothing runs on a schedule and no emails are sent in Phase 1. These settings show how the
        automation will be configured. Scheduling starts in Phase 4 and email notifications in Phase 6.
        {savedNote && !dirty && <span className="block pt-1 font-medium text-emerald-700">Saved in this browser.</span>}
      </DemoNotice>

      <div className="space-y-6">
        <Card title="Analysis schedule" description="How often new messages will be analysed once data sources are connected">
          <div className="max-w-xs">
            <select
              className={inputClass}
              aria-label="Analysis schedule"
              value={draft.analysisSchedule}
              onChange={(e) => setDraft({ ...draft, analysisSchedule: e.target.value as AutomationSettings["analysisSchedule"] })}
            >
              {Object.entries(scheduleLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </Card>

        <Card title="Escalation rules" description="Escalate open issues that stay unresolved too long">
          <div className="space-y-3">
            {draft.escalationRules.map((rule) => (
              <div key={rule.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-center justify-between gap-3">
                  <input
                    aria-label="Rule name"
                    className="min-w-0 flex-1 bg-transparent text-sm font-medium text-slate-900 outline-none"
                    value={rule.name}
                    onChange={(e) => updateEscalation(rule.id, { name: e.target.value })}
                  />
                  <Toggle label={`Enable ${rule.name}`} checked={rule.enabled} onChange={(enabled) => updateEscalation(rule.id, { enabled })} />
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <Field label="Urgency">
                    <select className={inputClass} value={rule.urgency} onChange={(e) => updateEscalation(rule.id, { urgency: e.target.value as Urgency })}>
                      {urgencyOrder.map((u) => (
                        <option key={u} value={u}>
                          {urgencyLabels[u]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Unresolved for more than (hours)">
                    <input
                      type="number"
                      min={1}
                      className={inputClass}
                      value={rule.afterHours}
                      onChange={(e) => updateEscalation(rule.id, { afterHours: Math.max(1, Number(e.target.value) || 1) })}
                    />
                  </Field>
                  <Field label="Escalate to">
                    <input className={inputClass} value={rule.escalateTo} onChange={(e) => updateEscalation(rule.id, { escalateTo: e.target.value })} />
                  </Field>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  With today&apos;s demo data this rule would escalate <strong className="text-slate-800">{wouldEscalate[rule.id]}</strong> open issues.
                </p>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Email notifications" description="Slack and WhatsApp are planned for later">
          <div className="divide-y divide-slate-100">
            {draft.notificationRules.map((rule) => (
              <div key={rule.id} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900">{rule.name}</p>
                  <p className="text-xs text-slate-500">When: {triggerLabels[rule.trigger]}</p>
                </div>
                <input
                  aria-label={`Recipients for ${rule.name}`}
                  className={`${inputClass} sm:w-72`}
                  value={rule.recipients}
                  onChange={(e) => updateNotification(rule.id, { recipients: e.target.value })}
                />
                <Toggle label={`Enable ${rule.name}`} checked={rule.enabled} onChange={(enabled) => updateNotification(rule.id, { enabled })} />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
