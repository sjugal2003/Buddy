"use client";

import { useActionState } from "react";
import { createIssue, updateIssue } from "@/app/actions/issues";
import type { FormState } from "@/app/actions/types";
import { Field, inputClass, keepValuesOnSubmit, primaryButton } from "@/components/ui/form";
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
import type { LiveCategory, LiveTeam } from "@/lib/data/live";
import type { Channel, Intent, IssueStatus, Sentiment } from "@/lib/types";

function options<T extends string>(labels: Record<T, string>, order?: T[]) {
  return (order ?? (Object.keys(labels) as T[])).map((value) => (
    <option key={value} value={value}>
      {labels[value]}
    </option>
  ));
}

function TeamAndCategory({
  teams,
  categories,
  teamId,
  categoryId,
  errors,
}: {
  teams: LiveTeam[];
  categories: LiveCategory[];
  teamId: string | null;
  categoryId: string | null;
  errors?: Record<string, string>;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Team" hint={teams.length === 0 ? "Owners and admins can add teams under Settings." : undefined}>
        <select name="teamId" defaultValue={teamId ?? ""} className={inputClass}>
          <option value="">No team yet</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <FieldError message={errors?.teamId} />
      </Field>
      <Field
        label="Category"
        hint={categories.length === 0 ? "Owners and admins can add categories under Settings." : undefined}
      >
        <select name="categoryId" defaultValue={categoryId ?? ""} className={inputClass}>
          <option value="">No category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <FieldError message={errors?.categoryId} />
      </Field>
    </div>
  );
}

function LetAiDecide({ aiReady }: { aiReady: boolean }) {
  return aiReady ? <option value="ai">Let AI decide</option> : null;
}

export function NewIssueForm({
  organizationId,
  teams,
  categories,
  aiReady,
}: {
  organizationId: string;
  teams: LiveTeam[];
  categories: LiveCategory[];
  /** AI is switched on for this company and set up on this server. */
  aiReady: boolean;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(createIssue, {});
  return (
    <form onSubmit={keepValuesOnSubmit(action)} className="space-y-4" noValidate>
      <input type="hidden" name="organizationId" value={organizationId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Customer name">
          <input name="customerName" required maxLength={120} className={inputClass} />
          <FieldError message={state.fieldErrors?.customerName} />
        </Field>
        <Field label="Customer email (optional)">
          <input name="customerEmail" type="email" maxLength={254} className={inputClass} />
          <FieldError message={state.fieldErrors?.customerEmail} />
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
          <select name="urgency" defaultValue={aiReady ? "ai" : "medium"} className={inputClass}>
            <LetAiDecide aiReady={aiReady} />
            {options(urgencyLabels, urgencyOrder)}
          </select>
          <FieldError message={state.fieldErrors?.urgency} />
        </Field>
        <Field label="Sentiment">
          <select name="sentiment" defaultValue={aiReady ? "ai" : "neutral"} className={inputClass}>
            <LetAiDecide aiReady={aiReady} />
            {options<Sentiment>(sentimentLabels)}
          </select>
          <FieldError message={state.fieldErrors?.sentiment} />
        </Field>
        <Field label="Type">
          <select name="intent" defaultValue={aiReady ? "ai" : "question"} className={inputClass}>
            <LetAiDecide aiReady={aiReady} />
            {options<Intent>(intentLabels)}
          </select>
          <FieldError message={state.fieldErrors?.intent} />
        </Field>
      </div>
      <TeamAndCategory
        teams={teams}
        categories={categories}
        teamId={null}
        categoryId={null}
        errors={state.fieldErrors}
      />
      <p className="text-xs text-slate-500">
        {aiReady
          ? "After saving, AI fills in anything left as \"Let AI decide\" and an empty category. What you choose yourself is kept."
          : "You set urgency, sentiment and type yourself. Owners and admins can switch on AI analysis in Settings."}
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
  teamId,
  categoryId,
  memberNames,
  teams,
  categories,
}: {
  issueId: string;
  status: IssueStatus;
  assigneeName: string | null;
  teamId: string | null;
  categoryId: string | null;
  memberNames: string[];
  teams: LiveTeam[];
  categories: LiveCategory[];
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateIssue, {});
  // Keep an assignee who has since left the workspace selectable.
  const names = Array.from(new Set(assigneeName ? [...memberNames, assigneeName] : memberNames));
  // React clears a form after its action runs. Keying it on the saved values
  // redraws it with them; the message sits outside the form so it stays.
  return (
    <div className="space-y-4">
      <form key={[status, assigneeName, teamId, categoryId].join("|")} action={action} className="space-y-4">
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
        <TeamAndCategory
          teams={teams}
          categories={categories}
          teamId={teamId}
          categoryId={categoryId}
          errors={state.fieldErrors}
        />
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? "Saving…" : "Save changes"}
        </button>
      </form>
      <FormMessage error={state.error} success={state.success} />
    </div>
  );
}
