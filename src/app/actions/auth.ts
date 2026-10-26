"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { siteUrl } from "@/lib/site-url";
import { getCurrentUser, safeNextPath } from "@/lib/auth";
import { friendlyError } from "@/lib/errors";
import {
  deleteAccountSchema,
  fieldErrors,
  forgotPasswordSchema,
  newPasswordSchema,
  signInSchema,
  signUpSchema,
} from "@/lib/validation";
import type { FormState } from "./types";

const NOT_CONFIGURED: FormState = {
  error: "Sign-in is not set up yet. Add the Supabase settings to .env.local (see the README).",
};

export async function signUp(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!isSupabaseConfigured()) return NOT_CONFIGURED;
  const parsed = signUpSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const site = await siteUrl();
  if ("error" in site) return { error: site.error };

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${site.url}/auth/confirm?next=/onboarding`,
    },
  });
  if (error) {
    console.error("[signUp]", error.code, error.message);
    if (error.code === "weak_password") return { fieldErrors: { password: "Choose a stronger password." } };
    if (error.code === "over_email_send_rate_limit") {
      return { error: "Too many sign-up emails were sent recently. Wait a while and try again." };
    }
    return { error: "We couldn't create your account. Please try again." };
  }
  // Supabase answers the same way whether or not the email is already
  // registered, so this page never reveals who has an account.
  redirect("/check-email");
}

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!isSupabaseConfigured()) return NOT_CONFIGURED;
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    if (error.code === "email_not_confirmed") {
      return { error: "Please confirm your email first. Check your inbox for the link we sent." };
    }
    console.error("[signIn]", error.code, error.message);
    return { error: "That email and password don't match an account." };
  }
  redirect(safeNextPath(formData.get("next")));
}

/**
 * "Forgot password?": Supabase emails a link that signs the person in once
 * (in the same browser) and lands on /reset-password. The answer is the same
 * whether or not the email has an account, so it never reveals who does.
 */
export async function requestPasswordReset(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!isSupabaseConfigured()) return NOT_CONFIGURED;
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const site = await siteUrl();
  if ("error" in site) return { error: site.error };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${site.url}/auth/confirm?next=/reset-password`,
  });
  if (error) {
    console.error("[requestPasswordReset]", error.code, error.message);
    if (error.code === "over_email_send_rate_limit" || error.status === 429) {
      return { error: "Too many emails were sent recently. Wait a while and try again." };
    }
    return { error: "We couldn't send the email. Please try again." };
  }
  return {
    success:
      "If an account uses this email, we've sent a link to choose a new password. Open it in this same browser within an hour.",
  };
}

/** Sets a new password for the signed-in person (after opening the reset link). */
export async function updatePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!isSupabaseConfigured()) return NOT_CONFIGURED;
  if (!(await getCurrentUser())) {
    return { error: "This reset link has ended. Ask for a new one on the Forgot password page." };
  }
  const parsed = newPasswordSchema.safeParse({ password: formData.get("password"), confirm: formData.get("confirm") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    console.error("[updatePassword]", error.code, error.message);
    if (error.code === "same_password") return { fieldErrors: { password: "Choose a password different from your old one." } };
    if (error.code === "weak_password") return { fieldErrors: { password: "Choose a stronger password." } };
    if (error.code === "reauthentication_needed") {
      return { error: "For safety, ask for a new reset link and use it straight away." };
    }
    return { error: "We couldn't change your password. Please try again." };
  }
  return { success: "Your password has been changed." };
}

export async function signOut() {
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}

/**
 * Deletes the signed-in person's own account (Phase 7 stage 37). The database
 * checks the typed email, refuses while they are the only owner of a company
 * with other people in it, deletes the companies they are alone in, and
 * deletes the sign-in itself.
 */
export async function deleteMyAccount(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return { error: "Your session has ended. Please sign in again." };
  const parsed = deleteAccountSchema.safeParse({ confirm: formData.get("confirm") ?? "" });
  if (!parsed.success) return { fieldErrors: { confirm: "Type your own email address to confirm." } };

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_my_account", { p_confirm: parsed.data.confirm });
  if (error) return { error: friendlyError(error, "We couldn't delete your account. Please try again.", "deleteMyAccount") };

  // The account is gone; clear this browser's sign-in too.
  await supabase.auth.signOut();
  redirect("/login?deleted=1");
}
