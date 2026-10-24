"use client";

import { useActionState } from "react";
import {
  createCategory,
  createTeam,
  deleteCategory,
  deleteTeam,
  updateAiSettings,
  updateCategory,
  updateOrganization,
  updateTeam,
} from "@/app/actions/settings";
import type { FormState } from "@/app/actions/types";
import { Field, inputClass, keepValuesOnSubmit, primaryButton, secondaryButton } from "@/components/ui/form";
import { FieldError, FormMessage } from "@/components/auth/auth-card";
import type { AiSettings, LiveCategory, LiveTeam, OrganizationSettings } from "@/lib/data/live";
import { urgencyLabels, urgencyOrder } from "@/lib/labels";
import type { Urgency } from "@/lib/types";

// Edit forms are keyed on their saved values, so they redraw with them after a
// save; messages sit outside the forms so they survive that. Forms people type
// a lot into keep their text when a save fails (keepValuesOnSubmit).

const targetField: Record<Urgency, string> = {
  critical: "targetCritical",
  high: "targetHigh",
  medium: "targetMedium",
  low: "targetLow",
};

const resolutionField: Record<Urgency, string> = {
  critical: "resolutionCritical",
  high: "resolutionHigh",
  medium: "resolutionMedium",
  low: "resolutionLow",
};

export function OrganizationForm({
  organizationId,
  settings,
  timeZones,
}: {
  organizationId: string;
  settings: OrganizationSettings;
  timeZones: string[];
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateOrganization, {});
  return (
    <div className="space-y-4">
      <form key={JSON.stringify(settings)} onSubmit={keepValuesOnSubmit(action)} className="space-y-4" noValidate>
        <input type="hidden" name="organizationId" value={organizationId} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company name">
            <input name="name" defaultValue={settings.name} maxLength={100} className={inputClass} />
            <FieldError message={state.fieldErrors?.name} />
          </Field>
          <Field label="Industry (optional)">
            <input name="industry" defaultValue={settings.industry} maxLength={100} className={inputClass} />
            <FieldError message={state.fieldErrors?.industry} />
          </Field>
        </div>
        <Field label="Time zone">
          <select name="timezone" defaultValue={settings.timezone} className={inputClass}>
            {timeZones.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
          <FieldError message={state.fieldErrors?.timezone} />
        </Field>
        <fieldset>
          <legend className="mb-1 text-xs font-medium text-slate-600">First-response targets (hours)</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {urgencyOrder.map((u) => (
              <Field key={u} label={urgencyLabels[u]}>
                <input
                  name={targetField[u]}
                  type="number"
                  min={1}
                  max={720}
                  step={1}
                  defaultValue={settings.targetHours[u]}
                  className={inputClass}
                />
                <FieldError message={state.fieldErrors?.[targetField[u]]} />
              </Field>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-1 text-xs font-medium text-slate-600">Resolution targets (hours)</legend>
          <p className="mb-2 text-xs text-slate-500">
            Counted from when the issue arrived, around the clock. Time in &ldquo;Waiting on customer&rdquo; doesn&apos;t count.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {urgencyOrder.map((u) => (
              <Field key={u} label={urgencyLabels[u]}>
                <input
                  name={resolutionField[u]}
                  type="number"
                  min={1}
                  max={2160}
                  step={1}
                  defaultValue={settings.resolutionHours[u]}
                  className={inputClass}
                />
                <FieldError message={state.fieldErrors?.[resolutionField[u]]} />
              </Field>
            ))}
          </div>
        </fieldset>
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? "Saving…" : "Save settings"}
        </button>
      </form>
      <FormMessage error={state.error} success={state.success} />
    </div>
  );
}

export function AiSettingsForm({
  organizationId,
  settings,
  isOwner,
}: {
  organizationId: string;
  settings: AiSettings;
  /** Only decides what is shown; the database refuses the change from anyone else. */
  isOwner: boolean;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateAiSettings, {});
  return (
    <div className="space-y-4">
      <form
        key={`${settings.enabled}-${settings.monthlyLimit}-${settings.autoRoute}`}
        onSubmit={keepValuesOnSubmit(action)}
        className="space-y-4"
        noValidate
      >
        <input type="hidden" name="organizationId" value={organizationId} />
        <label className="flex items-start gap-3 text-sm text-slate-700">
          <input
            name="enabled"
            type="checkbox"
            defaultChecked={settings.enabled}
            className="mt-0.5 h-4 w-4 rounded border-slate-300"
          />
          <span>
            <span className="font-medium text-slate-900">Analyse new issues with AI</span>
            <span className="block text-xs text-slate-500">
              Sends each issue&apos;s subject, message (up to 4,000 characters), channel and your category names to
              the AI service (Gemini or Claude). Never the customer&apos;s name.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-3 text-sm text-slate-700">
          <input
            name={isOwner ? "autoRoute" : undefined}
            type="checkbox"
            defaultChecked={settings.autoRoute}
            disabled={!isOwner}
            className="mt-0.5 h-4 w-4 rounded border-slate-300"
          />
          <span>
            <span className="font-medium text-slate-900">Apply routing automatically</span>
            <span className="block text-xs text-slate-500">
              After the AI analyses an issue that has no team, give it the team its matching routing rules
              names. Off means rules only suggest a team.
              {!isOwner && " Only an owner can change this."}
            </span>
          </span>
        </label>
        {/* Admins keep the owner's choice when they save the other settings. */}
        {!isOwner && settings.autoRoute && <input type="hidden" name="autoRoute" value="on" />}
        <Field label="Monthly limit (analyses)" hint="Up to 2,000. Buddy stops asking the AI once this is used.">
          <input
            name="monthlyLimit"
            type="number"
            min={0}
            max={2000}
            step={1}
            defaultValue={settings.monthlyLimit}
            className={`${inputClass} sm:w-40`}
          />
          <FieldError message={state.fieldErrors?.monthlyLimit} />
        </Field>
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? "Saving…" : "Save AI settings"}
        </button>
      </form>
      <FormMessage error={state.error} success={state.success} />
    </div>
  );
}

function TeamFields({ team, errors }: { team?: LiveTeam; errors?: Record<string, string> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
      <Field label="Team name">
        <input name="name" defaultValue={team?.name} maxLength={80} className={inputClass} />
        <FieldError message={errors?.name} />
      </Field>
      <Field label="Lead (optional)">
        <input name="leadName" defaultValue={team?.leadName} maxLength={80} className={inputClass} />
        <FieldError message={errors?.leadName} />
      </Field>
      <Field label="Team email (optional)">
        <input name="email" type="email" defaultValue={team?.email} className={inputClass} />
        <FieldError message={errors?.email} />
      </Field>
      <Field label="Colour">
        <input
          name="color"
          type="color"
          defaultValue={team?.color ?? "#6366f1"}
          className="h-[38px] w-14 cursor-pointer rounded-lg border border-slate-300 bg-white p-1"
        />
        <FieldError message={errors?.color} />
      </Field>
    </div>
  );
}

export function TeamRow({ team }: { team: LiveTeam }) {
  const [saveState, saveAction, saving] = useActionState<FormState, FormData>(updateTeam, {});
  const [deleteState, deleteAction, deleting] = useActionState<FormState, FormData>(deleteTeam, {});
  return (
    <li className="space-y-2 py-4">
      <form key={JSON.stringify(team)} action={saveAction} className="space-y-3" noValidate>
        <input type="hidden" name="teamId" value={team.id} />
        <TeamFields team={team} errors={saveState.fieldErrors} />
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={saving} className={`${secondaryButton} py-1.5`}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="submit"
            formAction={deleteAction}
            disabled={deleting}
            onClick={(e) => {
              if (!window.confirm(`Delete the team "${team.name}"? Its issues become unassigned.`)) e.preventDefault();
            }}
            className={`${secondaryButton} py-1.5 text-red-700`}
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </form>
      <FormMessage error={saveState.error ?? deleteState.error} success={saveState.success} />
    </li>
  );
}

export function AddTeamForm({ organizationId }: { organizationId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createTeam, {});
  return (
    <div className="space-y-2">
      {/* A new key after each success clears the form for the next team. */}
      <form key={state.success} onSubmit={keepValuesOnSubmit(action)} className="space-y-3" noValidate>
        <input type="hidden" name="organizationId" value={organizationId} />
        <TeamFields errors={state.fieldErrors} />
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? "Adding…" : "Add team"}
        </button>
      </form>
      <FormMessage error={state.error} success={state.success} />
    </div>
  );
}

export function CategoryRow({ category }: { category: LiveCategory }) {
  const [saveState, saveAction, saving] = useActionState<FormState, FormData>(updateCategory, {});
  const [deleteState, deleteAction, deleting] = useActionState<FormState, FormData>(deleteCategory, {});
  return (
    <li className="space-y-2 py-3">
      <form key={category.name} action={saveAction} className="flex flex-wrap items-start gap-2" noValidate>
        <input type="hidden" name="categoryId" value={category.id} />
        <div className="min-w-0 flex-1">
          <label className="sr-only" htmlFor={`category-${category.id}`}>
            Category name
          </label>
          <input
            id={`category-${category.id}`}
            name="name"
            defaultValue={category.name}
            maxLength={80}
            className={inputClass}
          />
          <FieldError message={saveState.fieldErrors?.name} />
        </div>
        <button type="submit" disabled={saving} className={`${secondaryButton} py-2`}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="submit"
          formAction={deleteAction}
          disabled={deleting}
          onClick={(e) => {
            if (!window.confirm(`Delete the category "${category.name}"? Issues that use it will have no category.`)) {
              e.preventDefault();
            }
          }}
          className={`${secondaryButton} py-2 text-red-700`}
        >
          {deleting ? "Deleting…" : "Delete"}
        </button>
      </form>
      <FormMessage error={saveState.error ?? deleteState.error} success={saveState.success} />
    </li>
  );
}

export function AddCategoryForm({ organizationId }: { organizationId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createCategory, {});
  return (
    <div className="space-y-2">
      <form key={state.success} onSubmit={keepValuesOnSubmit(action)} className="flex flex-wrap items-start gap-2" noValidate>
        <input type="hidden" name="organizationId" value={organizationId} />
        <div className="min-w-0 flex-1">
          <label className="sr-only" htmlFor="new-category">
            New category name
          </label>
          <input id="new-category" name="name" maxLength={80} placeholder="For example: Billing" className={inputClass} />
          <FieldError message={state.fieldErrors?.name} />
        </div>
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? "Adding…" : "Add category"}
        </button>
      </form>
      <FormMessage error={state.error} success={state.success} />
    </div>
  );
}
