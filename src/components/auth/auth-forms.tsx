"use client";

import { useActionState } from "react";
import Link from "next/link";
import { requestPasswordReset, signIn, signUp, updatePassword } from "@/app/actions/auth";
import type { FormState } from "@/app/actions/types";
import { Field, inputClass, primaryButton } from "@/components/ui/form";
import { FieldError, FormMessage } from "./auth-card";

export function SignInForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(signIn, {});
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <FormMessage error={state.error} />
      <Field label="Email">
        <input name="email" type="email" autoComplete="email" required className={inputClass} />
        <FieldError message={state.fieldErrors?.email} />
      </Field>
      <Field label="Password">
        <input name="password" type="password" autoComplete="current-password" required className={inputClass} />
        <FieldError message={state.fieldErrors?.password} />
      </Field>
      <button type="submit" disabled={pending} className={`${primaryButton} w-full`}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
      <p className="text-center text-sm">
        <Link href="/forgot-password" className="font-medium text-brand-600 hover:underline">
          Forgot password?
        </Link>
      </p>
    </form>
  );
}

export function SignUpForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(signUp, {});
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage error={state.error} />
      <Field label="Your name">
        <input name="fullName" autoComplete="name" required className={inputClass} />
        <FieldError message={state.fieldErrors?.fullName} />
      </Field>
      <Field label="Work email">
        <input name="email" type="email" autoComplete="email" required className={inputClass} />
        <FieldError message={state.fieldErrors?.email} />
      </Field>
      <Field label="Password" hint="At least 8 characters.">
        <input name="password" type="password" autoComplete="new-password" required className={inputClass} />
        <FieldError message={state.fieldErrors?.password} />
      </Field>
      <button type="submit" disabled={pending} className={`${primaryButton} w-full`}>
        {pending ? "Creating account…" : "Create account"}
      </button>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(requestPasswordReset, {});
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage error={state.error} success={state.success} />
      <Field label="Email">
        <input name="email" type="email" autoComplete="email" required className={inputClass} />
        <FieldError message={state.fieldErrors?.email} />
      </Field>
      <button type="submit" disabled={pending} className={`${primaryButton} w-full`}>
        {pending ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}

export function NewPasswordForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(updatePassword, {});
  if (state.success) {
    return (
      <div className="space-y-4">
        <FormMessage success={state.success} />
        <Link href="/" className={`${primaryButton} block w-full text-center`}>
          Continue to Buddy
        </Link>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage error={state.error} />
      <Field label="New password" hint="At least 8 characters.">
        <input name="password" type="password" autoComplete="new-password" required className={inputClass} />
        <FieldError message={state.fieldErrors?.password} />
      </Field>
      <Field label="Type it again">
        <input name="confirm" type="password" autoComplete="new-password" required className={inputClass} />
        <FieldError message={state.fieldErrors?.confirm} />
      </Field>
      <button type="submit" disabled={pending} className={`${primaryButton} w-full`}>
        {pending ? "Saving…" : "Save new password"}
      </button>
    </form>
  );
}
