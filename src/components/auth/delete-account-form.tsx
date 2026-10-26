"use client";

import { useActionState } from "react";
import { deleteMyAccount } from "@/app/actions/auth";
import type { FormState } from "@/app/actions/types";
import { Field, inputClass, keepValuesOnSubmit, secondaryButton } from "@/components/ui/form";
import { FieldError, FormMessage } from "@/components/auth/auth-card";

// The database checks the email and the companies again; this only asks first.
export function DeleteAccountForm({ email, blocked }: { email: string; blocked: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(deleteMyAccount, {});
  return (
    <div className="space-y-3">
      <form onSubmit={keepValuesOnSubmit(action)} className="space-y-3" noValidate>
        <Field label={`Type ${email} to confirm`}>
          <input name="confirm" type="email" autoComplete="off" maxLength={254} className={inputClass} disabled={blocked} />
          <FieldError message={state.fieldErrors?.confirm} />
        </Field>
        <button
          type="submit"
          disabled={pending || blocked}
          className={`${secondaryButton} border-red-300 text-red-700 hover:bg-red-50`}
        >
          {pending ? "Deleting…" : "Delete my account for good"}
        </button>
      </form>
      <FormMessage error={state.error} />
    </div>
  );
}
