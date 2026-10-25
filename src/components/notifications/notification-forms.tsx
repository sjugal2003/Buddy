"use client";

import { useActionState } from "react";
import { markAllNotificationsRead, markNotificationRead } from "@/app/actions/notifications";
import type { FormState } from "@/app/actions/types";
import { FormMessage } from "@/components/auth/auth-card";
import { secondaryButton } from "@/components/ui/form";

export function MarkReadButton({ notificationId }: { notificationId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(markNotificationRead, {});
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="notificationId" value={notificationId} />
      <button type="submit" disabled={pending} className={secondaryButton} data-testid="notification-mark-read">
        {pending ? "Saving…" : "Mark as read"}
      </button>
      {state.error && <FormMessage error={state.error} />}
    </form>
  );
}

export function MarkAllReadButton({ organizationId }: { organizationId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(markAllNotificationsRead, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <button type="submit" disabled={pending} className={secondaryButton} data-testid="notification-mark-all-read">
        {pending ? "Saving…" : "Mark all as read"}
      </button>
      <FormMessage error={state.error} success={state.success} />
    </form>
  );
}
