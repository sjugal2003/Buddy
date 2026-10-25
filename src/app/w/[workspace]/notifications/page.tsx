import Link from "next/link";
import { notFound } from "next/navigation";
import { MarkAllReadButton, MarkReadButton } from "@/components/notifications/notification-forms";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth";
import { getMembershipBySlug, listNotifications } from "@/lib/data/live";
import { formatDateTimeIn } from "@/lib/format";
import { NOTIFICATION_LIST_LIMIT, notificationHref, notificationKindLabels } from "@/lib/notifications";

export const dynamic = "force-dynamic";

export default async function NotificationsPage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace: slug } = await params;
  const user = await requireUser(`/w/${slug}/notifications`);
  const membership = await getMembershipBySlug(user.id, slug);
  if (!membership) notFound();

  const timeZone = membership.organization.timezone;
  const notifications = await listNotifications(membership.organization.id);

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Your own notifications for this company. Only you can see them. They appear in Buddy only: nothing is emailed."
        // Kept on screen after use, so its result stays visible.
        actions={notifications.length > 0 ? <MarkAllReadButton organizationId={membership.organization.id} /> : undefined}
      />

      <Card>
        {notifications.length === 0 ? (
          <div className="py-6 text-center text-sm" data-testid="notifications-empty">
            <p className="font-medium text-slate-900">No notifications yet.</p>
            <p className="mt-1 text-slate-500">
              Buddy will add them here for events such as escalations, urgent issues and import problems.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100" data-testid="notification-list">
            {notifications.map((n) => (
              <li
                key={n.id}
                className="flex flex-wrap items-start justify-between gap-3 py-3"
                data-testid="notification-item"
                data-read={n.readAt ? "true" : "false"}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-slate-500">
                    {notificationKindLabels[n.kind]} · {formatDateTimeIn(n.createdAt, timeZone)}
                    {!n.readAt && <span className="ml-2 font-semibold text-brand-700">Unread</span>}
                  </p>
                  <Link
                    href={notificationHref(slug, n.kind, n.issueId)}
                    className={`mt-0.5 block break-words text-sm hover:underline ${n.readAt ? "text-slate-600" : "font-medium text-slate-900"}`}
                  >
                    {n.title}
                  </Link>
                </div>
                {!n.readAt && <MarkReadButton notificationId={n.id} />}
              </li>
            ))}
          </ul>
        )}
        {notifications.length >= NOTIFICATION_LIST_LIMIT && (
          <p className="mt-3 text-xs text-slate-500">Showing your {NOTIFICATION_LIST_LIMIT} most recent notifications.</p>
        )}
      </Card>
    </>
  );
}
