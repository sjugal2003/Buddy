"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import { fetchPlay, type FetchPlayResult } from "@/app/actions/play";
import { FormMessage } from "@/components/auth/auth-card";
import { primaryButton } from "@/components/ui/form";

// "Fetch new reviews" for owners and admins. The result comes only from what
// the database reports it saved.

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function describePlayFetch(result: Extract<FetchPlayResult, { runId: string }>) {
  if (result.found === 0) return "Google Play had no reviews with text from the last week.";
  const parts = [`Google Play sent ${plural(result.found, "review", "reviews")}: ${result.imported} added as issues`];
  if (result.duplicate > 0) parts.push(`${result.duplicate} already in Buddy`);
  if (result.skipped > 0) parts.push(`${result.skipped} without text skipped`);
  if (result.rejected > 0) parts.push(`${result.rejected} could not be saved (see the import history)`);
  let text = `${parts.join(", ")}.`;
  if (result.truncated) text += " There were more than 500, so the oldest of them were left out.";
  return text;
}

export function PlayFetch({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<FetchPlayResult | null>(null);

  function run() {
    setResult(null);
    startTransition(async () => {
      let answer: FetchPlayResult;
      try {
        answer = await fetchPlay(organizationId);
      } catch {
        answer = { error: "The connection to Buddy was lost. Check the import history before trying again." };
      }
      setResult(answer);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3" data-testid="play-fetch">
      <button type="button" onClick={run} disabled={pending} className={primaryButton} data-testid="play-fetch-button">
        <Star className="h-4 w-4" aria-hidden />
        {pending ? "Fetching…" : "Fetch new reviews"}
      </button>
      {result && (
        <div data-testid="play-fetch-result">
          {"error" in result ? <FormMessage error={result.error} /> : <FormMessage success={describePlayFetch(result)} />}
        </div>
      )}
    </div>
  );
}
