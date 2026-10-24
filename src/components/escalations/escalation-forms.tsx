"use client";

import { useActionState } from "react";
import { acknowledgeEscalation, runEscalationCheck, updateEscalationSettings } from "@/app/actions/escalations";
import type { FormState } from "@/app/actions/types";
import { inputClass, keepValuesOnSubmit, primaryButton, secondaryButton } from "@/components/ui/form";
import { FieldError, FormMessage } from "@/components/auth/auth-card";
import type { EscalationSettings } from "@/lib/data/live";

interface Condition {
  name: keyof EscalationSettings & string;
  label: string;
  level: string;
  hours?: { name: keyof EscalationSettings & string; min: number; before: string; after: string };
}

const conditions: Condition[] = [
  { name: "firstResponse", label: "First-response target breached", level: "Level 1" },
  { name: "resolution", label: "Resolution target breached", level: "Level 2" },
  {
    name: "urgentNoTeam",
    label: "Critical or High urgency still has no team",
    level: "Level 2 if Critical, else 1",
    hours: { name: "urgentNoTeamHours", min: 0, before: "after", after: "hours" },
  },
  {
    name: "noTeam",
    label: "Open with no team",
    level: "Level 1",
    hours: { name: "noTeamHours", min: 0, before: "after", after: "hours" },
  },
  {
    name: "noUpdate",
    label: "No update",
    level: "Level 1",
    hours: { name: "noUpdateHours", min: 1, before: "for", after: "hours" },
  },
];

export function EscalationSettingsForm({ organizationId, settings }: { organizationId: string; settings: EscalationSettings }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateEscalationSettings, {});
  return (
    <div className="space-y-4">
      <form key={JSON.stringify(settings)} onSubmit={keepValuesOnSubmit(action)} className="space-y-3" noValidate>
        <input type="hidden" name="organizationId" value={organizationId} />
        {conditions.map((c) => (
          <div key={c.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-700">
            <label className="flex items-center gap-3">
              <input
                name={c.name}
                type="checkbox"
                defaultChecked={settings[c.name] as boolean}
                className="h-4 w-4 rounded border-slate-300"
              />
              <span className="font-medium text-slate-900">{c.label}</span>
            </label>
            {c.hours && (
              <label className="flex items-center gap-2 text-slate-600">
                {c.hours.before}
                <input
                  name={c.hours.name}
                  type="number"
                  min={c.hours.min}
                  max={720}
                  step={1}
                  defaultValue={settings[c.hours.name] as number}
                  aria-label={`${c.label}: hours`}
                  className={`${inputClass} w-20`}
                />
                {c.hours.after}
              </label>
            )}
            <span className="text-xs text-slate-500">{c.level}</span>
            {c.hours && <FieldError message={state.fieldErrors?.[c.hours.name]} />}
          </div>
        ))}
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? "Saving…" : "Save escalation settings"}
        </button>
      </form>
      <FormMessage error={state.error} success={state.success} />
    </div>
  );
}

export function CheckNowButton({ organizationId }: { organizationId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(runEscalationCheck, {});
  return (
    <div className="space-y-2">
      <form action={action}>
        <input type="hidden" name="organizationId" value={organizationId} />
        <button type="submit" disabled={pending} className={secondaryButton}>
          {pending ? "Checking…" : "Check now"}
        </button>
      </form>
      <FormMessage error={state.error} success={state.success} />
    </div>
  );
}

export function AcknowledgeForm({ escalationId }: { escalationId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(acknowledgeEscalation, {});
  return (
    <div className="space-y-2">
      <form onSubmit={keepValuesOnSubmit(action)} className="flex flex-wrap gap-2" noValidate>
        <input type="hidden" name="escalationId" value={escalationId} />
        <input
          name="note"
          maxLength={500}
          placeholder="Note (optional)"
          aria-label="Acknowledgement note"
          className={`${inputClass} min-w-0 flex-1`}
        />
        <button type="submit" disabled={pending} className={secondaryButton}>
          {pending ? "Saving…" : "Acknowledge"}
        </button>
      </form>
      <FieldError message={state.fieldErrors?.note} />
      <FormMessage error={state.error} success={state.success} />
    </div>
  );
}
