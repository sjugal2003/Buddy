"use client";

import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { useActionState, useState } from "react";
import {
  applySuggestedTeam,
  createRule,
  deleteRule,
  dismissRoutingSuggestion,
  moveRule,
  routeUnassignedIssues,
  toggleRule,
  updateRule,
} from "@/app/actions/routing";
import type { FormState } from "@/app/actions/types";
import { Field, inputClass, keepValuesOnSubmit, primaryButton, secondaryButton } from "@/components/ui/form";
import { FieldError, FormMessage } from "@/components/auth/auth-card";
import type { LiveCategory, LiveTeam } from "@/lib/data/live";
import { channelLabels, intentLabels, sentimentLabels, urgencyLabels, urgencyOrder } from "@/lib/labels";
import type { RoutingRule, RuleCondition, RuleField } from "@/lib/types";

export const fieldLabels: Record<RuleField, string> = {
  category: "Category is",
  urgency: "Urgency is",
  sentiment: "Sentiment is",
  intent: "Type is",
  channel: "Channel is",
  keyword: "Message contains",
};

function valueOptions(field: RuleField, categories: LiveCategory[]): [string, string][] | null {
  switch (field) {
    case "category":
      return categories.map((c) => [c.id, c.name]);
    case "urgency":
      return urgencyOrder.map((u) => [u, urgencyLabels[u]]);
    case "sentiment":
      return Object.entries(sentimentLabels);
    case "intent":
      return Object.entries(intentLabels);
    case "channel":
      return Object.entries(channelLabels);
    case "keyword":
      return null;
  }
}

/** A readable summary such as "urgency is High or message contains refund". */
export function describeRule(rule: RoutingRule, categories: LiveCategory[]) {
  const parts = rule.conditions.map((c) => {
    const options = valueOptions(c.field, categories);
    const value = options ? (options.find(([v]) => v === c.value)?.[1] ?? "(deleted)") : `"${c.value}"`;
    return `${fieldLabels[c.field].toLowerCase()} ${value}`;
  });
  return parts.join(rule.match === "all" ? " and " : " or ");
}

const emptyCondition = (categories: LiveCategory[]): RuleCondition =>
  categories.length > 0 ? { field: "category", value: categories[0].id } : { field: "urgency", value: "high" };

/** Add or edit a rule. Conditions are edited in the browser and sent as one JSON field. */
export function RuleEditor({
  organizationId,
  rule,
  teams,
  categories,
  onDone,
}: {
  organizationId: string;
  rule?: RoutingRule;
  teams: LiveTeam[];
  categories: LiveCategory[];
  /** Called with the success message once the rule is saved. */
  onDone: (success: string) => void;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(async (prev, formData) => {
    const result = await (rule ? updateRule : createRule)(prev, formData);
    if (result.success) onDone(result.success);
    return result;
  }, {});
  const [conditions, setConditions] = useState<RuleCondition[]>(rule?.conditions ?? [emptyCondition(categories)]);
  const update = (index: number, change: RuleCondition) =>
    setConditions((list) => list.map((c, i) => (i === index ? change : c)));

  return (
    <div className="space-y-2">
      <form
        onSubmit={keepValuesOnSubmit(action)}
        className="space-y-4 rounded-lg border border-brand-200 bg-brand-50/40 p-4"
        noValidate
      >
        {rule ? (
          <input type="hidden" name="ruleId" value={rule.id} />
        ) : (
          <input type="hidden" name="organizationId" value={organizationId} />
        )}
        <input type="hidden" name="conditions" value={JSON.stringify(conditions)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Rule name">
            <input name="name" defaultValue={rule?.name} maxLength={100} className={inputClass} />
            <FieldError message={state.fieldErrors?.name} />
          </Field>
          <Field label="Suggest this team">
            <select name="teamId" defaultValue={rule?.teamId ?? teams[0]?.id} className={inputClass}>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <FieldError message={state.fieldErrors?.teamId} />
          </Field>
        </div>
        <Field label="Match when">
          <select name="match" defaultValue={rule?.match ?? "any"} className={inputClass}>
            <option value="any">Any condition is true</option>
            <option value="all">All conditions are true</option>
          </select>
        </Field>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-xs font-medium text-slate-600">Conditions</legend>
          {conditions.map((condition, index) => {
            const options = valueOptions(condition.field, categories);
            return (
              <div key={index} className="flex flex-col gap-2 sm:flex-row">
                <select
                  aria-label={`Condition ${index + 1} field`}
                  value={condition.field}
                  onChange={(e) => {
                    const field = e.target.value as RuleField;
                    const first = valueOptions(field, categories)?.[0]?.[0] ?? "";
                    update(index, { field, value: first });
                  }}
                  className={`${inputClass} sm:w-48`}
                >
                  {(Object.keys(fieldLabels) as RuleField[]).map((f) => (
                    <option key={f} value={f} disabled={f === "category" && categories.length === 0}>
                      {fieldLabels[f]}
                    </option>
                  ))}
                </select>
                {options ? (
                  <select
                    aria-label={`Condition ${index + 1} value`}
                    value={condition.value}
                    onChange={(e) => update(index, { ...condition, value: e.target.value })}
                    className={inputClass}
                  >
                    {options.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    aria-label={`Condition ${index + 1} value`}
                    value={condition.value}
                    maxLength={200}
                    placeholder="For example: refund"
                    onChange={(e) => update(index, { ...condition, value: e.target.value })}
                    className={inputClass}
                  />
                )}
                <button
                  type="button"
                  disabled={conditions.length === 1}
                  onClick={() => setConditions((list) => list.filter((_, i) => i !== index))}
                  className={`${secondaryButton} px-2`}
                  aria-label={`Remove condition ${index + 1}`}
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
            );
          })}
          <FieldError message={state.fieldErrors?.conditions} />
          {conditions.length < 20 && (
            <button
              type="button"
              onClick={() => setConditions((list) => [...list, emptyCondition(categories)])}
              className={`${secondaryButton} py-1.5 text-xs`}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden /> Add condition
            </button>
          )}
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={pending} className={primaryButton}>
            {pending ? "Saving…" : rule ? "Save rule" : "Add rule"}
          </button>
          {rule && (
            <button type="button" onClick={() => onDone("")} className={secondaryButton}>
              Cancel
            </button>
          )}
        </div>
      </form>
      <FormMessage error={state.error} />
    </div>
  );
}

/** The "add a rule" form; it starts empty again after each rule is added. */
export function AddRule({
  organizationId,
  teams,
  categories,
}: {
  organizationId: string;
  teams: LiveTeam[];
  categories: LiveCategory[];
}) {
  const [added, setAdded] = useState<{ count: number; message: string }>({ count: 0, message: "" });
  return (
    <div className="space-y-2">
      <RuleEditor
        key={added.count}
        organizationId={organizationId}
        teams={teams}
        categories={categories}
        onDone={(message) => setAdded((a) => ({ count: a.count + 1, message }))}
      />
      <FormMessage success={added.message || undefined} />
    </div>
  );
}

/** One rule in the list, with its buttons for owners and admins. */
export function RuleRow({
  rule,
  index,
  count,
  teams,
  categories,
  canEdit,
}: {
  rule: RoutingRule;
  index: number;
  count: number;
  teams: LiveTeam[];
  categories: LiveCategory[];
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState("");
  const [toggleState, toggleAction, toggling] = useActionState<FormState, FormData>(toggleRule, {});
  const [moveState, moveAction, moving] = useActionState<FormState, FormData>(moveRule, {});
  const [deleteState, deleteAction, deleting] = useActionState<FormState, FormData>(deleteRule, {});
  const team = teams.find((t) => t.id === rule.teamId);
  const error = toggleState.error ?? moveState.error ?? deleteState.error;

  return (
    <li className="space-y-2 py-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-medium text-slate-600">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-medium ${rule.enabled ? "text-slate-900" : "text-slate-400"}`}>
            {rule.name} {!rule.enabled && <span className="font-normal">(off)</span>}
          </p>
          <p className="text-sm text-slate-600">
            If {describeRule(rule, categories)}, suggest{" "}
            <span className="inline-flex items-center gap-1 font-medium text-slate-800">
              {team && <span className="h-2 w-2 rounded-full" style={{ background: team.color }} aria-hidden />}
              {team?.name ?? "a deleted team"}
            </span>
          </p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-1.5">
            <form action={toggleAction}>
              <input type="hidden" name="ruleId" value={rule.id} />
              <input type="hidden" name="enabled" value={rule.enabled ? "false" : "true"} />
              <button type="submit" disabled={toggling} className={`${secondaryButton} py-1 text-xs`}>
                {rule.enabled ? "Switch off" : "Switch on"}
              </button>
            </form>
            <form action={moveAction} className="flex gap-1">
              <input type="hidden" name="ruleId" value={rule.id} />
              <button
                type="submit"
                name="direction"
                value="up"
                disabled={moving || index === 0}
                className={`${secondaryButton} px-2 py-1`}
                aria-label={`Move ${rule.name} up`}
              >
                <ArrowUp className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button
                type="submit"
                name="direction"
                value="down"
                disabled={moving || index === count - 1}
                className={`${secondaryButton} px-2 py-1`}
                aria-label={`Move ${rule.name} down`}
              >
                <ArrowDown className="h-3.5 w-3.5" aria-hidden />
              </button>
            </form>
            <button
              type="button"
              onClick={() => {
                setEditing((e) => !e);
                setSaved("");
              }}
              className={`${secondaryButton} py-1 text-xs`}
            >
              {editing ? "Close" : "Edit"}
            </button>
            <form
              action={deleteAction}
              onSubmit={(e) => {
                if (!window.confirm(`Delete the rule "${rule.name}"?`)) e.preventDefault();
              }}
            >
              <input type="hidden" name="ruleId" value={rule.id} />
              <button
                type="submit"
                disabled={deleting}
                className={`${secondaryButton} px-2 py-1 text-red-700`}
                aria-label={`Delete ${rule.name}`}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </form>
          </div>
        )}
      </div>
      {editing && (
        <RuleEditor
          organizationId={rule.workspaceId}
          rule={rule}
          teams={teams}
          categories={categories}
          onDone={(message) => {
            setEditing(false);
            setSaved(message);
          }}
        />
      )}
      <FormMessage error={error} success={saved || undefined} />
    </li>
  );
}

export function RouteUnassignedButton({ organizationId }: { organizationId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(routeUnassignedIssues, {});
  return (
    <div className="space-y-2">
      <form action={action}>
        <input type="hidden" name="organizationId" value={organizationId} />
        <button type="submit" disabled={pending} className={secondaryButton}>
          {pending ? "Routing…" : "Route open issues that have no team"}
        </button>
      </form>
      <FormMessage error={state.error} success={state.success} />
    </div>
  );
}

export function ApplySuggestionButton({
  organizationId,
  issueId,
  ruleId,
  label,
}: {
  organizationId: string;
  issueId: string;
  /** The server checks this rule still matches the issue before using it. */
  ruleId: string;
  label: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(applySuggestedTeam, {});
  return (
    <div className="space-y-2">
      <form action={action}>
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="issueId" value={issueId} />
        <input type="hidden" name="ruleId" value={ruleId} />
        <button type="submit" disabled={pending} className={`${secondaryButton} w-full`}>
          {pending ? "Applying…" : label}
        </button>
      </form>
      <FormMessage error={state.error} success={state.success} />
    </div>
  );
}

export function DismissSuggestionButton({ issueId }: { issueId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(dismissRoutingSuggestion, {});
  return (
    <div className="space-y-2">
      <form action={action}>
        <input type="hidden" name="issueId" value={issueId} />
        <button type="submit" disabled={pending} className="text-xs font-medium text-slate-500 hover:text-slate-700 hover:underline">
          {pending ? "Dismissing…" : "Dismiss suggestion"}
        </button>
      </form>
      <FormMessage error={state.error} success={state.success} />
    </div>
  );
}
