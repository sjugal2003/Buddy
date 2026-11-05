"use client";

import { useActionState } from "react";
import { connectPlay, disconnectPlay } from "@/app/actions/play";
import type { FormState } from "@/app/actions/types";
import { FieldError, FormMessage } from "@/components/auth/auth-card";
import { Field, inputClass, primaryButton, secondaryButton } from "@/components/ui/form";

// Owners connect the company's own Google Play app with its own service
// account key (improvement B, step 1). The key goes to Buddy's server once,
// is encrypted there, and is never shown again.

export function PlayConnect({ organizationId, slug }: { organizationId: string; slug: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(connectPlay, {});
  return (
    <form action={action} className="space-y-3" data-testid="play-connect-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="slug" value={slug} />
      <Field label="App package name" hint="As in Play Console, for example com.example.shop.">
        <input name="packageName" className={inputClass} autoComplete="off" spellCheck={false} maxLength={150} required />
      </Field>
      <FieldError message={state.fieldErrors?.packageName} />
      <Field
        label="Service account key (JSON)"
        hint="Open the JSON key file Google gave you, copy everything in it, and paste it here. Buddy keeps it encrypted and never shows it again."
      >
        <textarea
          name="serviceAccountKey"
          rows={5}
          className={`${inputClass} font-mono text-xs`}
          autoComplete="off"
          spellCheck={false}
          required
        />
      </Field>
      <FieldError message={state.fieldErrors?.serviceAccountKey} />
      <button type="submit" className={primaryButton} disabled={pending} data-testid="play-connect">
        {pending ? "Checking with Google…" : "Connect Google Play"}
      </button>
      <FormMessage error={state.error} success={state.success} />
    </form>
  );
}

export function PlayDisconnect({ organizationId, slug }: { organizationId: string; slug: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(disconnectPlay, {});
  return (
    <div className="space-y-2">
      <form
        action={action}
        onSubmit={(e) => {
          if (!window.confirm("Disconnect Google Play? Buddy deletes the saved key. Issues already in Buddy stay.")) e.preventDefault();
        }}
      >
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="slug" value={slug} />
        <button type="submit" className={secondaryButton} disabled={pending} data-testid="play-disconnect">
          {pending ? "Disconnecting…" : "Disconnect Google Play"}
        </button>
      </form>
      <FormMessage error={state.error} success={state.success} />
    </div>
  );
}
