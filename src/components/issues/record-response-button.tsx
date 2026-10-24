"use client";

import { useActionState } from "react";
import { recordFirstResponse } from "@/app/actions/issues";
import type { FormState } from "@/app/actions/types";
import { secondaryButton } from "@/components/ui/form";
import { FormMessage } from "@/components/auth/auth-card";

export function RecordFirstResponseButton({ issueId }: { issueId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(recordFirstResponse, {});
  return (
    <div className="space-y-2">
      <form action={action}>
        <input type="hidden" name="issueId" value={issueId} />
        <button type="submit" disabled={pending} className={`${secondaryButton} w-full`}>
          {pending ? "Recording…" : "Record first response"}
        </button>
      </form>
      <p className="text-xs text-slate-500">Press this once you have replied to the customer (Buddy can&apos;t send replies yet).</p>
      <FormMessage error={state.error} success={state.success} />
    </div>
  );
}
