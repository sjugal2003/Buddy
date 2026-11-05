"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { friendlyError } from "@/lib/errors";
import { aiResultKey } from "@/lib/ai";
import { decryptToken, encryptToken } from "@/lib/gmail/crypto";
import { PlayError, accessToken, credentialKey, listReviews, playMode, privateKeyWorks } from "@/lib/play";
import { parseServiceAccount, reviewsToRows, type ServiceAccount } from "@/lib/play/review";
import { idSchema, playConnectSchema } from "@/lib/validation";
import type { FormState } from "./types";

// Google Play reviews (improvement B, step 1). Owners connect the company's
// own app with its own service-account key; owners and admins fetch recent
// reviews as issues (read-only: nothing on Google Play changes). The database
// checks every role again. The key is encrypted before it leaves this server
// and is never logged, sent to the browser or shown again.

const OFF =
  "Google Play is switched off on this server. A real app brings in real customer reviews, which Buddy isn't approved for yet.";

const playErrors: Record<PlayError["kind"], string> = {
  key: "Google didn't accept this service account key. It may have been deleted: make a new JSON key in Google Cloud and connect again.",
  access:
    "Google Play refused access. In Play Console, open Users and permissions, invite the service account's address, and give it access to this app.",
  app: "Google Play has no app with that package name for this account. Check the package name.",
  google: "Google Play could not be reached. Nothing was saved. Please try again in a minute.",
};

function describeFailure(error: unknown, context: string) {
  // Only the kind and status are logged, never keys or review text.
  console.error(`[${context}]`, error instanceof PlayError ? `${error.kind}: ${error.message}` : "unexpected error");
  return playErrors[error instanceof PlayError ? error.kind : "google"];
}

async function requireOwner(organizationId: string, userId: string, context: string): Promise<string | null> {
  const supabase = await createClient();
  const membership = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (membership.error) return friendlyError(membership.error, "Something went wrong. Please try again.", context);
  return membership.data?.role === "owner" ? null : "Only the company owner can connect or disconnect Google Play.";
}

export async function connectPlay(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Your session has ended. Please sign in again." };
  const parsed = playConnectSchema.safeParse({
    organizationId: formData.get("organizationId"),
    slug: formData.get("slug"),
    packageName: formData.get("packageName"),
    serviceAccountKey: formData.get("serviceAccountKey"),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    if (fieldErrors.organizationId || fieldErrors.slug) return { error: "Something went wrong. Reload the page and try again." };
    return { fieldErrors };
  }
  const { organizationId, slug, packageName, serviceAccountKey } = parsed.data;
  if (playMode() === "off") return { error: OFF };
  const key = credentialKey();
  if (!key) return { error: OFF };

  // Owners only, checked before Google is asked; save_source_connection checks again.
  const notOwner = await requireOwner(organizationId, user.id, "connectPlay");
  if (notOwner) return { error: notOwner };

  const account = parseServiceAccount(serviceAccountKey);
  if ("error" in account) return { fieldErrors: { serviceAccountKey: account.error } };
  if (!privateKeyWorks(account.privateKey)) {
    return { fieldErrors: { serviceAccountKey: "The private key in that file can't be read. Make a new JSON key and paste all of it." } };
  }

  // Check the key and the app with Google before saving anything: one page of one review.
  try {
    await listReviews(await accessToken(account), packageName, 1);
  } catch (error) {
    return { error: describeFailure(error, "connectPlay") };
  }

  const encrypted = encryptToken(JSON.stringify({ client_email: account.clientEmail, private_key: account.privateKey }), key);
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_source_connection", {
    p_organization_id: organizationId,
    p_kind: "google_play",
    p_package_name: packageName,
    p_account_email: account.clientEmail,
    p_encrypted_credential: encrypted,
  });
  if (error) return { error: friendlyError(error, "We couldn't save the connection. Please try again.", "connectPlay") };
  revalidatePath("/w/[workspace]", "layout");
  // The card redraws as connected, so the page shows the result.
  redirect(`/w/${slug}/data-sources?play=connected`);
}

export async function disconnectPlay(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Your session has ended. Please sign in again." };
  const organizationId = idSchema.safeParse(formData.get("organizationId"));
  const slug = formData.get("slug");
  if (!organizationId.success || typeof slug !== "string" || !/^[a-z0-9-]{1,63}$/.test(slug)) {
    return { error: "Something went wrong. Reload the page and try again." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("disconnect_source", { p_organization_id: organizationId.data, p_kind: "google_play" });
  if (error) return { error: friendlyError(error, "We couldn't disconnect Google Play. Please try again.", "disconnectPlay") };
  revalidatePath("/w/[workspace]", "layout");
  if (data !== true) return { error: "Google Play was not connected. Reload the page." };
  redirect(`/w/${slug}/data-sources?play=disconnected`);
}

export type FetchPlayResult =
  | {
      runId: string;
      /** Reviews Google sent this time. */
      found: number;
      imported: number;
      duplicate: number;
      rejected: number;
      /** Reviews with no text or time, which can't become issues. */
      skipped: number;
      /** More than MAX_PAGES pages: the oldest were left out. */
      truncated: boolean;
    }
  | { error: string };

/**
 * "Fetch new reviews": reads the app's recent reviews (read-only) and saves
 * each as an issue through import_issues, which refuses anyone but owners and
 * admins of the company and never saves the same review twice. The counts
 * reported come from what the database says it saved.
 */
export async function fetchPlay(organizationId: string): Promise<FetchPlayResult> {
  if (!(await getCurrentUser())) return { error: "Your session has ended. Please sign in again." };
  const parsed = idSchema.safeParse(organizationId);
  if (!parsed.success) return { error: "Something went wrong. Reload the page and try again." };
  if (playMode() === "off") return { error: OFF };
  const serverKey = aiResultKey();
  if (!serverKey) return { error: "Fetching needs BUDDY_AI_RESULT_KEY on this server: run npm.cmd run ai-key (see the README)." };

  const supabase = await createClient();
  const started = await supabase.rpc("start_source_fetch", {
    p_organization_id: parsed.data,
    p_kind: "google_play",
    p_server_key: serverKey,
  });
  if (started.error) return { error: friendlyError(started.error, "We couldn't start fetching. Please try again.", "fetchPlay") };
  const start = (started.data as { run_id: string; package_name: string; encrypted_credential: string }[] | null)?.[0];
  if (!start) return { error: "We couldn't start fetching. Please try again." };

  const runId = start.run_id;
  const stop = async (message: string) => {
    await supabase.rpc("finish_source_fetch", { p_run_id: runId, p_error: message });
    revalidatePath("/w/[workspace]", "layout");
    return { error: message };
  };

  const key = credentialKey();
  const plain = key ? decryptToken(start.encrypted_credential, key) : null;
  let account: ServiceAccount | null = null;
  try {
    const saved = plain ? (JSON.parse(plain) as { client_email?: unknown; private_key?: unknown }) : null;
    if (saved && typeof saved.client_email === "string" && typeof saved.private_key === "string") {
      account = { clientEmail: saved.client_email, privateKey: saved.private_key };
    }
  } catch {
    account = null;
  }
  if (!account) {
    return stop("Buddy can't read the saved key (GMAIL_TOKEN_KEY may have changed). An owner can disconnect Google Play and connect it again.");
  }

  let listed: Awaited<ReturnType<typeof listReviews>>;
  try {
    listed = await listReviews(await accessToken(account), start.package_name);
  } catch (error) {
    return stop(describeFailure(error, "fetchPlay"));
  }

  const { rows, skipped } = reviewsToRows(listed.reviews);
  let counts = { imported: 0, duplicate: 0, rejected: 0 };
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const saved = await supabase.rpc("import_issues", { p_run_id: runId, p_rows: batch, p_as_history: false });
    if (saved.error || !Array.isArray(saved.data) || saved.data.length !== batch.length) {
      if (saved.error) console.error("[fetchPlay] import_issues", saved.error.code);
      return stop("We couldn't save the fetched reviews. Check the import history, then try again.");
    }
    for (const outcome of saved.data as { outcome: keyof typeof counts }[]) {
      counts = { ...counts, [outcome.outcome]: counts[outcome.outcome] + 1 };
    }
  }

  const finished = await supabase.rpc("finish_source_fetch", { p_run_id: runId, p_error: null });
  revalidatePath("/w/[workspace]", "layout");
  if (finished.error) {
    return { error: friendlyError(finished.error, "The reviews were saved, but the fetch could not be closed. Check the import history.", "fetchPlay") };
  }
  return { runId, found: listed.reviews.length, ...counts, skipped, truncated: listed.truncated };
}
