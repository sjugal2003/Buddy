"use client";

import { useActionState } from "react";
import { createIssue, updateIssue } from "@/app/actions/issues";
import type { FormState } from "@/app/actions/types";
import { Field, inputClass, primaryButton } from "@/components/ui/form";
import { FieldError, FormMessage } from "@/components/auth/auth-card";
import {
  channelLabels,
  intentLabels,
  sentimentLabels,
  statusLabels,
  statusOrder,
  urgencyLabels,
  urgencyOrder,
} from "@/lib/labels";
import type { Channel, Intent, IssueStatus, Sentiment } from "@/lib/types";

function options<T extends string>(labels: Record<T, string>, order?: T[]) {
  return (order ?? (Object.keys(labels) as T[])).map((value) => (
    <option key={value} value={value}>
      {labels[value]}
    </option>
  ));
}

export function NewIssueForm({ organizationId }: { organizationId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createIssue, {});
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="organizationId" value={organizationId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Customer name">
          <input name="customerName" required maxLength={120} className={inputClass} />
          <FieldError message={state.fieldErrors?.customerName} />
        </Field>
        <Field label="Where it came from">
          <select name="channel" defaultValue="email" className={inputClass}>
            {options<Channel>(channelLabels)}
          </select>
          <FieldError message={state.fieldErrors?.channel} />
        </Field>
      </div>
      <Field label="Subject">
        <input name="subject" required maxLength={200} className={inputClass} />
        <FieldError message={state.fieldErrors?.subject} />
      </Field>
      <Field label="What the customer said">
        <textarea name="message" required maxLength={10000} rows={6} className={inputClass} />
        <FieldError message={state.fieldErrors?.message} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Urgency">
          <select name="urgency" defaultValue="medium" className={inputClass}>
            {options(urgencyLabels, urgencyOrder)}
          </select>
          <FieldError message={state.fieldErrors?.urgency} />
        </Field>
        <Field label="Sentiment">
          <select name="sentiment" defaultValue="neutral" className={inputClass}>
            {options<Sentiment>(sentimentLabels)}
          </select>
          <FieldError message={state.fieldErrors?.sentiment} />
        </Field>
        <Field label="Type">
          <select name="intent" defaultValue="question" className={inputClass}>
            {options<Intent>(intentLabels)}
          </select>
          <FieldError message={state.fieldErrors?.intent} />
        </Field>
      </div>
      <p className="text-xs text-slate-500">
        You set urgency, sentiment and type yourself for now. Automatic analysis comes in a later phase.
      </p>
      <FormMessage error={state.error} />
      <button type="submit" disabled={pending} className={primaryButton}>
        {pending ? "Saving…" : "Save issue"}
      </button>
    </form>
  );
}

export function UpdateIssueForm({
  issueId,
  status,
  assigneeName,
  memberNames,
}: {
  issueId: string;
  status: IssueStatus;
  assigneeName: string | null;
  memberNames: string[];
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateIssue, {});
  // Keep an assignee who has since left the workspace selectable.
  const names = Array.from(new Set(assigneeName ? [...memberNames, assigneeName] : memberNames));
  // React clears a form after its action runs. Keying it on the saved values
  // redraws it with them; the message sits outside the form so it stays.
  return (
    <div className="space-y-4">
      <form key={`${status}|${assigneeName ?? ""}`} action={action} className="space-y-4">
        <input type="hidden" name="issueId" value={issueId} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Status">
            <select name="status" defaultValue={status} className={inputClass}>
              {options<IssueStatus>(statusLabels, statusOrder)}
            </select>
            <FieldError message={state.fieldErrors?.status} />
          </Field>
          <Field label="Assigned to">
            <select name="assigneeName" defaultValue={assigneeName ?? ""} className={inputClass}>
              <option value="">Nobody</option>
              {names.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <FieldError message={state.fieldErrors?.assigneeName} />
          </Field>
        </div>
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? "Saving…" : "Save changes"}
        </button>
      </form>
      <FormMessage error={state.error} success={state.success} />
    </div>
  );
}
