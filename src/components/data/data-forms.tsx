"use client";

import { useActionState } from "react";
import { deleteCustomerData, deleteIssue, updateRetention } from "@/app/actions/data";
import type { FormState } from "@/app/actions/types";
import { Field, inputClass, keepValuesOnSubmit, primaryButton, secondaryButton } from "@/components/ui/form";
import { FieldError, FormMessage } from "@/components/auth/auth-card";
import { RETENTION_OPTIONS } from "@/lib/data-retention";

// Owner-only forms for deleting data. Each asks for a clear confirmation
// first; the database checks the role again and logs every deletion.

const dangerButton = `${secondaryButton} border-red-300 text-red-700 hover:bg-red-50`;

export function DeleteIssueForm({ issueId, reference }: { issueId: string; reference: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(deleteIssue, {});
  return (
    <div className="space-y-3">
      <form onSubmit={keepValuesOnSubmit(action)} className="space-y-3" noValidate>
        <input type="hidden" name="issueId" value={issueId} />
        <Field label={`Type ${reference} to confirm`}>
          <input name="confirm" autoComplete="off" maxLength={40} className={inputClass} />
          <FieldError message={state.fieldErrors?.confirm} />
        </Field>
        <button type="submit" disabled={pending} className={dangerButton}>
          {pending ? "Deleting…" : "Delete this issue for good"}
        </button>
      </form>
      <FormMessage error={state.error} />
    </div>
  );
}

export function DeleteCustomerDataForm({ organizationId }: { organizationId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(deleteCustomerData, {});
  return (
    <div className="space-y-3">
      {/* A new key after each success clears the form. */}
      <form key={state.success} onSubmit={keepValuesOnSubmit(action)} className="space-y-3" noValidate>
        <input type="hidden" name="organizationId" value={organizationId} />
        <Field label="Customer's email" hint="Deletes every issue in this company with this customer email.">
          <input name="email" type="email" autoComplete="off" maxLength={254} className={inputClass} />
          <FieldError message={state.fieldErrors?.email} />
        </Field>
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input name="confirm" type="checkbox" className="mt-0.5" />
          <span>I understand this permanently deletes these issues, their history and the AI&rsquo;s notes about them.</span>
        </label>
        <FieldError message={state.fieldErrors?.confirm} />
        <button type="submit" disabled={pending} className={dangerButton}>
          {pending ? "Deleting…" : "Delete this customer's issues"}
        </button>
      </form>
      <FormMessage error={state.error} success={state.success} />
    </div>
  );
}

export function RetentionForm({ organizationId, retentionDays }: { organizationId: string; retentionDays: number | null }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateRetention, {});
  return (
    <div className="space-y-3">
      <form key={String(retentionDays)} action={action} className="flex flex-wrap items-end gap-2" noValidate>
        <input type="hidden" name="organizationId" value={organizationId} />
        <div className="min-w-0 flex-1">
          <Field label="Delete resolved issues">
            <select name="retentionDays" defaultValue={retentionDays ?? ""} className={inputClass}>
              {RETENTION_OPTIONS.map((o) => (
                <option key={o.label} value={o.days ?? ""}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <FieldError message={state.fieldErrors?.retentionDays} />
        </div>
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? "Saving…" : "Save"}
        </button>
      </form>
      <FormMessage error={state.error} success={state.success} />
    </div>
  );
}
