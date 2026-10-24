"use client";

import { useActionState } from "react";
import { disconnectGmail } from "@/app/actions/gmail";
import type { FormState } from "@/app/actions/types";
import { FormMessage } from "@/components/auth/auth-card";
import { secondaryButton } from "@/components/ui/form";

export function GmailDisconnect({ organizationId, slug }: { organizationId: string; slug: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(disconnectGmail, {});
  return (
    <div className="space-y-2">
      <form
        action={action}
        onSubmit={(e) => {
          if (!window.confirm("Disconnect this inbox? Issues already in Buddy stay.")) e.preventDefault();
        }}
      >
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="slug" value={slug} />
        <button type="submit" className={secondaryButton} disabled={pending} data-testid="gmail-disconnect">
          {pending ? "Disconnecting…" : "Disconnect Gmail"}
        </button>
      </form>
      <FormMessage error={state.error} success={state.success} />
    </div>
  );
}
