"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Inbox } from "lucide-react";
import { fetchGmail, type FetchGmailResult } from "@/app/actions/gmail";
import { FormMessage } from "@/components/auth/auth-card";
import { ImportAiButton } from "@/components/data-sources/import-ai-button";
import { primaryButton } from "@/components/ui/form";

// "Fetch new email" (Phase 5 stage 26), for owners and admins. The result
// comes only from what the database reports it saved. AI analysis stays a
// separate step that asks first, as for CSV imports.

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function describe(result: Extract<FetchGmailResult, { runId: string }>) {
  if (result.found === 0) return "No new email since the last fetch.";
  const parts = [`Fetched ${plural(result.found, "new email", "new emails")}: ${result.imported} added as issues`];
  if (result.duplicate > 0) parts.push(`${result.duplicate} already in Buddy`);
  if (result.rejected > 0) parts.push(`${result.rejected} could not be saved (see the import history)`);
  let text = `${parts.join(", ")}.`;
  if (result.waiting > 0) text += ` ${plural(result.waiting, "more email is", "more emails are")} waiting: press Fetch again.`;
  if (result.skippedOlder) text += " Gmail had more than 500 new emails, so the oldest of them were left out.";
  return text;
}

export function GmailFetch({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<FetchGmailResult | null>(null);

  function run() {
    setResult(null);
    startTransition(async () => {
      let answer: FetchGmailResult;
      try {
        answer = await fetchGmail(organizationId);
      } catch {
        answer = { error: "The connection to Buddy was lost. Check the import history before trying again." };
      }
      setResult(answer);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3" data-testid="gmail-fetch">
      <button type="button" onClick={run} disabled={pending} className={primaryButton} data-testid="gmail-fetch-button">
        <Inbox className="h-4 w-4" aria-hidden />
        {pending ? "Fetching…" : "Fetch new email"}
      </button>
      {result && (
        <div className="space-y-2" data-testid="gmail-fetch-result">
          {"error" in result ? <FormMessage error={result.error} /> : <FormMessage success={describe(result)} />}
          {"runId" in result && result.imported > 0 && <ImportAiButton runId={result.runId} />}
        </div>
      )}
    </div>
  );
}
