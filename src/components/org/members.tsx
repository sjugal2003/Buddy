"use client";

import { useActionState, useState } from "react";
import { Check, Copy } from "lucide-react";
import { acceptInvitation, changeMemberRole, createInvitation, removeMember } from "@/app/actions/organizations";
import type { FormState } from "@/app/actions/types";
import { Field, inputClass, primaryButton, secondaryButton } from "@/components/ui/form";
import { FieldError, FormMessage } from "@/components/auth/auth-card";
import type { Member, Role } from "@/lib/data/live";

const roleLabels: Record<Role, string> = { owner: "Owner", admin: "Admin", member: "Member" };

export function MemberRow({
  organizationId,
  member,
  myRole,
  isMe,
}: {
  organizationId: string;
  member: Member;
  myRole: Role;
  isMe: boolean;
}) {
  const [roleState, roleAction, rolePending] = useActionState<FormState, FormData>(changeMemberRole, {});
  const [removeState, removeAction, removePending] = useActionState<FormState, FormData>(removeMember, {});

  // These only decide which buttons to show. The database makes the real
  // decision and refuses anything this user is not allowed to do.
  const canChangeRole = myRole === "owner" && !isMe;
  const canRemove = isMe || myRole === "owner" || (myRole === "admin" && member.role !== "owner");

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-900">
            {member.fullName} {isMe && <span className="font-normal text-slate-500">(you)</span>}
          </p>
          {!canChangeRole && <p className="text-xs text-slate-500">{roleLabels[member.role]}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canChangeRole && (
            <form action={roleAction} className="flex items-center gap-2">
              <input type="hidden" name="organizationId" value={organizationId} />
              <input type="hidden" name="userId" value={member.userId} />
              <label className="sr-only" htmlFor={`role-${member.userId}`}>
                Role for {member.fullName}
              </label>
              <select
                id={`role-${member.userId}`}
                name="role"
                defaultValue={member.role}
                className={`${inputClass} w-auto py-1.5`}
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                <option value="owner">Owner</option>
              </select>
              <button type="submit" disabled={rolePending} className={`${secondaryButton} py-1.5`}>
                {rolePending ? "Saving…" : "Save"}
              </button>
            </form>
          )}
          {canRemove && (
            <form
              action={removeAction}
              onSubmit={(e) => {
                const question = isMe ? "Leave this workspace?" : `Remove ${member.fullName} from this workspace?`;
                if (!window.confirm(question)) e.preventDefault();
              }}
            >
              <input type="hidden" name="organizationId" value={organizationId} />
              <input type="hidden" name="userId" value={member.userId} />
              <button type="submit" disabled={removePending} className={`${secondaryButton} py-1.5 text-red-700`}>
                {isMe ? "Leave" : "Remove"}
              </button>
            </form>
          )}
        </div>
      </div>
      <div className="mt-2 space-y-2 empty:hidden">
        <FormMessage error={roleState.error} success={roleState.success} />
        <FormMessage error={removeState.error} success={removeState.success} />
      </div>
    </li>
  );
}

export function InviteForm({ organizationId }: { organizationId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createInvitation, {});
  return (
    <div className="space-y-4">
      <form action={action} className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end" noValidate>
        <input type="hidden" name="organizationId" value={organizationId} />
        <Field label="Email address">
          <input name="email" type="email" required className={inputClass} placeholder="colleague@company.com" />
          <FieldError message={state.fieldErrors?.email} />
        </Field>
        <Field label="Role">
          <select name="role" defaultValue="member" className={inputClass}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </Field>
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? "Creating…" : "Create invite link"}
        </button>
      </form>
      <FormMessage error={state.error} success={state.success} />
      {state.link && <InviteLink key={state.link} link={state.link} />}
    </div>
  );
}

function InviteLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
      <p className="text-slate-700">
        Buddy does not send emails yet. Copy this link and send it to them yourself. It works once, only for that email
        address, and expires in 7 days. It is shown only now.
      </p>
      <div className="mt-2 flex gap-2">
        <input readOnly value={link} className={`${inputClass} font-mono text-xs`} aria-label="Invitation link" />
        <button
          type="button"
          className={secondaryButton}
          onClick={async () => {
            await navigator.clipboard.writeText(link);
            setCopied(true);
          }}
        >
          {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export function AcceptInviteForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(acceptInvitation, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <FormMessage error={state.error} />
      <button type="submit" disabled={pending} className={`${primaryButton} w-full`}>
        {pending ? "Joining…" : "Accept invitation"}
      </button>
    </form>
  );
}
