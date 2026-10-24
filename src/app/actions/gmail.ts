"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { friendlyError } from "@/lib/errors";
import {
  GmailError,
  getMessage,
  gmailStatus,
  listMessageIds,
  refreshAccessToken,
  revokeToken,
  tokenKey,
} from "@/lib/gmail";
import { decryptToken } from "@/lib/gmail/crypto";
import { fetchQuery, messageToRow, planFetch, receivedAt, type GmailMessage } from "@/lib/gmail/message";
import { idSchema } from "@/lib/validation";
import type { FormState } from "./types";

// Disconnecting the company's Gmail inbox (owners only; the database checks).
// Buddy first asks Google to cancel its access, then deletes the connection
// and its token. Issues already in Buddy stay.

export async function disconnectGmail(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return { error: "Your session has ended. Please sign in again." };
  const organizationId = idSchema.safeParse(formData.get("organizationId"));
  if (!organizationId.success) return { error: "Something went wrong. Reload the page and try again." };

  const supabase = await createClient();
  // Only owners and admins get the token; disconnect_mailbox below refuses admins.
  const token = await supabase.rpc("mailbox_token", { p_organization_id: organizationId.data });
  if (token.error) return { error: friendlyError(token.error, "We couldn't disconnect the inbox. Please try again.", "disconnectGmail") };

  let revoked = false;
  const key = tokenKey();
  const refreshToken = typeof token.data === "string" && key ? decryptToken(token.data, key) : null;
  if (refreshToken) revoked = await revokeToken(refreshToken);

  const { data, error } = await supabase.rpc("disconnect_mailbox", { p_organization_id: organizationId.data });
  if (error) return { error: friendlyError(error, "We couldn't disconnect the inbox. Please try again.", "disconnectGmail") };
  revalidatePath("/w/[workspace]", "layout");
  if (data !== true) return { error: "No inbox was connected. Reload the page." };
  // The card redraws without the connection, so the result is shown by the page.
  const slug = formData.get("slug");
  if (typeof slug !== "string" || !/^[a-z0-9-]{1,63}$/.test(slug)) return { success: "Gmail disconnected." };
  redirect(`/w/${slug}/data-sources?gmail=${revoked ? "disconnected" : "disconnected_local"}`);
}

export type FetchGmailResult =
  | {
      runId: string;
      /** New emails Gmail had for Buddy this time. */
      found: number;
      imported: number;
      duplicate: number;
      rejected: number;
      /** Emails still waiting; pressing again fetches them. */
      waiting: number;
      /** More than 500 new emails: the oldest of them were left out. */
      skippedOlder: boolean;
    }
  | { error: string };

const gmailErrors: Record<GmailError["kind"] | "key", string> = {
  expired:
    "Google's sign-in for this inbox has ended (in testing mode it lasts 7 days). An owner can disconnect Gmail and connect it again.",
  scope: "Gmail refused access. An owner can disconnect Gmail and connect it again, allowing Buddy to read email.",
  google: "Gmail could not be reached. Nothing more was saved. Please try again in a minute.",
  key: "Buddy can't read the saved Google sign-in (GMAIL_TOKEN_KEY may have changed). An owner can disconnect Gmail and connect it again.",
};

/** Runs at most `limit` of the tasks at a time, keeping their order. */
async function inTurns<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * "Fetch new email" (Phase 5 stage 26): reads the inbox's new emails since the
 * last fetch (read-only; nothing in Gmail changes) and saves each one as an
 * issue through import_issues, which refuses anyone but owners and admins of
 * the company and never saves the same email twice. The counts reported come
 * from what the database says it saved.
 */
export async function fetchGmail(organizationId: string): Promise<FetchGmailResult> {
  if (!(await getCurrentUser())) return { error: "Your session has ended. Please sign in again." };
  const parsed = idSchema.safeParse(organizationId);
  if (!parsed.success) return { error: "Something went wrong. Reload the page and try again." };
  if (gmailStatus() === "not_configured") {
    return { error: "Gmail is not set up on this server yet (see the README)." };
  }

  const supabase = await createClient();
  const started = await supabase.rpc("start_gmail_fetch", { p_organization_id: parsed.data });
  if (started.error) return { error: friendlyError(started.error, "We couldn't start fetching. Please try again.", "fetchGmail") };
  const start = (started.data as { run_id: string; fetched_until: string | null; encrypted_token: string }[] | null)?.[0];
  if (!start) return { error: "We couldn't start fetching. Please try again." };

  const runId = start.run_id;
  let newestSeen: Date | null = null;
  const stop = async (message: string) => {
    await supabase.rpc("finish_gmail_fetch", {
      p_run_id: runId,
      p_fetched_until: newestSeen?.toISOString() ?? null,
      p_error: message,
    });
    revalidatePath("/w/[workspace]", "layout");
    return { error: message };
  };

  const key = tokenKey();
  const refreshToken = key ? decryptToken(start.encrypted_token, key) : null;
  if (!refreshToken) return stop(gmailErrors.key);

  const fetchedUntil = start.fetched_until ? new Date(start.fetched_until) : null;
  let messages: GmailMessage[];
  let plan: ReturnType<typeof planFetch>;
  try {
    const accessToken = await refreshAccessToken(refreshToken);
    const listed = await listMessageIds(accessToken, fetchQuery(fetchedUntil));
    plan = planFetch(listed.ids, listed.truncated);
    messages = await inTurns(plan.batch, 5, (id) => getMessage(accessToken, id));
  } catch (error) {
    // Only the kind and status are logged, never tokens or email content.
    console.error("[fetchGmail]", error instanceof GmailError ? `${error.kind}: ${error.message}` : "unexpected error");
    return stop(gmailErrors[error instanceof GmailError ? error.kind : "google"]);
  }

  // The email Gmail returns again at the boundary (searches are in whole seconds) is left out.
  const fresh = messages
    .filter((m) => {
      const at = receivedAt(m);
      return at !== null && (!fetchedUntil || at > fetchedUntil);
    })
    .sort((a, b) => receivedAt(a)!.getTime() - receivedAt(b)!.getTime());

  let counts = { imported: 0, duplicate: 0, rejected: 0 };
  if (fresh.length > 0) {
    const rows = fresh.map((m, i) => messageToRow(m, i + 1));
    const saved = await supabase.rpc("import_issues", { p_run_id: runId, p_rows: rows, p_as_history: false });
    if (saved.error || !Array.isArray(saved.data) || saved.data.length !== rows.length) {
      if (saved.error) console.error("[fetchGmail] import_issues", saved.error.code);
      return stop("We couldn't save the fetched emails. Check the import history, then try again.");
    }
    for (const outcome of saved.data as { outcome: keyof typeof counts }[]) counts = { ...counts, [outcome.outcome]: counts[outcome.outcome] + 1 };
    newestSeen = receivedAt(fresh[fresh.length - 1]);
  }

  const finished = await supabase.rpc("finish_gmail_fetch", {
    p_run_id: runId,
    p_fetched_until: newestSeen?.toISOString() ?? null,
    p_error: null,
  });
  revalidatePath("/w/[workspace]", "layout");
  if (finished.error) {
    return { error: friendlyError(finished.error, "The emails were saved, but the fetch could not be closed. Check the import history.", "fetchGmail") };
  }
  return { runId, found: fresh.length, ...counts, waiting: plan.waiting, skippedOlder: plan.skippedOlder };
}
