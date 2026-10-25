import Link from "next/link";
import { notFound } from "next/navigation";
import { LogOut, Sparkles } from "lucide-react";
import { signOut } from "@/app/actions/auth";
import { WorkspaceSwitcher } from "@/components/org/workspace-switcher";
import { WorkspaceNav } from "@/components/issues/workspace-nav";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { requireUser } from "@/lib/auth";
import { countUnreadNotifications, getMembershipBySlug, listMyMemberships } from "@/lib/data/live";

export const dynamic = "force-dynamic";

export default async function LiveWorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const user = await requireUser(`/w/${slug}`);
  // Looked up through the user's own memberships: a company they don't
  // belong to gives the same "not found" page as one that doesn't exist.
  const membership = await getMembershipBySlug(user.id, slug);
  if (!membership) notFound();
  const [memberships, unread] = await Promise.all([
    listMyMemberships(user.id),
    // A failed count must not take the whole workspace down; the bell then shows no number.
    countUnreadNotifications(membership.organization.id).catch(() => null),
  ]);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
              <Sparkles className="h-4 w-4" aria-hidden />
            </span>
            <span className="font-semibold text-slate-900">Buddy</span>
          </Link>
          <WorkspaceSwitcher
            current={slug}
            options={memberships.map((m) => ({ slug: m.organization.slug, name: m.organization.name }))}
          />
          <div className="ml-auto flex items-center gap-3">
            <NotificationBell slug={slug} unread={unread} />
            <span className="hidden text-sm text-slate-500 sm:inline">{user.email}</span>
            <form action={signOut}>
              <button type="submit" className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
                <LogOut className="h-4 w-4" aria-hidden />
                Sign out
              </button>
            </form>
          </div>
        </div>
        <WorkspaceNav slug={slug} />
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:py-8">{children}</main>
    </div>
  );
}
