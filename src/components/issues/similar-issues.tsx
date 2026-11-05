"use client";

import { useActionState } from "react";
import { linkDuplicate, unlinkDuplicate } from "@/app/actions/similar";
import type { FormState } from "@/app/actions/types";
import { secondaryButton } from "@/components/ui/form";
import { FormMessage } from "@/components/auth/auth-card";

/** Marks this issue as another report of the main issue. The database checks everything again. */
export function SameProblemButton({ issueId, mainId, mainReference }: { issueId: string; mainId: string; mainReference: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(linkDuplicate, {});
  return (
    <div className="space-y-1">
      <form action={action}>
        <input type="hidden" name="issueId" value={issueId} />
        <input type="hidden" name="mainId" value={mainId} />
        <button
          type="submit"
          disabled={pending}
          className={`${secondaryButton} py-1 text-xs`}
          aria-label={`Same problem as ${mainReference}`}
          title={`Mark this issue as another report of ${mainReference}`}
        >
          {pending ? "Linking…" : "Same problem"}
        </button>
      </form>
      <FormMessage error={state.error} />
    </div>
  );
}

export function UnlinkButton({ issueId }: { issueId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(unlinkDuplicate, {});
  return (
    <div className="space-y-1">
      <form action={action}>
        <input type="hidden" name="issueId" value={issueId} />
        <button type="submit" disabled={pending} className={`${secondaryButton} py-1 text-xs`}>
          {pending ? "Unlinking…" : "Unlink"}
        </button>
      </form>
      <FormMessage error={state.error} />
    </div>
  );
}
