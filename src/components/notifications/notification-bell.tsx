import Link from "next/link";
import { Bell } from "lucide-react";
import { unreadBadge, unreadLabel } from "@/lib/notifications";

/** The bell in the workspace header, with the signed-in person's unread count. */
/** `unread` is null when the count could not be loaded. */
export function NotificationBell({ slug, unread }: { slug: string; unread: number | null }) {
  const badge = unreadBadge(unread);
  const label = unreadLabel(unread);
  return (
    <Link
      href={`/w/${slug}/notifications`}
      aria-label={label}
      title={label}
      className="relative inline-flex items-center rounded-lg p-1.5 text-slate-600 hover:bg-slate-100"
      data-testid="notification-bell"
    >
      <Bell className="h-5 w-5" aria-hidden />
      {badge && (
        <span
          className="absolute -right-1 -top-1 min-w-[1.25rem] rounded-full bg-red-600 px-1 text-center text-xs font-semibold leading-5 text-white"
          data-testid="notification-count"
        >
          {badge}
        </span>
      )}
    </Link>
  );
}
