"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Tabs for a real workspace. */
export function WorkspaceNav({ slug }: { slug: string }) {
  const pathname = usePathname();
  const tabs = [
    { href: `/w/${slug}`, label: "Overview", active: pathname === `/w/${slug}` },
    { href: `/w/${slug}/issues`, label: "Issues", active: pathname.startsWith(`/w/${slug}/issues`) },
  ];
  return (
    <nav aria-label="Workspace" className="mx-auto flex max-w-5xl gap-1 px-4 sm:px-6">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.active ? "page" : undefined}
          className={`border-b-2 px-3 py-2 text-sm font-medium ${
            tab.active ? "border-brand-600 text-brand-700" : "border-transparent text-slate-600 hover:text-slate-900"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
