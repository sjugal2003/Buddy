"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Menu, Sparkles, X } from "lucide-react";
import { navItems } from "./nav-items";
import { useWorkspace } from "@/components/workspace/workspace-store";

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { workspace, workspaces } = useWorkspace();
  const base = `/demo/${workspace.slug}`;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
          <Sparkles className="h-4 w-4" aria-hidden />
        </div>
        <div>
          <p className="text-sm font-semibold text-white">Buddy</p>
          <p className="text-[11px] text-slate-400">Customer intelligence hub</p>
        </div>
      </div>

      <div className="px-3 pb-4">
        <label htmlFor="workspace-switcher" className="mb-1 block px-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
          Workspace
        </label>
        <select
          id="workspace-switcher"
          value={workspace.slug}
          onChange={(e) => {
            const rest = pathname.slice(base.length);
            router.push(`/demo/${e.target.value}${rest}`);
            onNavigate?.();
          }}
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-2 text-sm text-white outline-none focus:border-brand-500"
        >
          {workspaces.map((w) => (
            <option key={w.id} value={w.slug}>
              {w.name}
            </option>
          ))}
        </select>
      </div>

      <nav className="flex-1 space-y-0.5 px-3" aria-label="Main">
        {navItems.map((item) => {
          const href = `${base}${item.href}`;
          const active = item.href === "" ? pathname === base : pathname.startsWith(href);
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                active ? "bg-slate-800 font-medium text-white" : "text-slate-300 hover:bg-slate-800/60 hover:text-white"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="m-3 rounded-lg border border-slate-700 bg-slate-800/60 p-3 text-xs text-slate-400">
        <p className="font-medium text-slate-200">Demo workspace</p>
        <p className="mt-1">Fictional companies and demo data. Changes stay in this browser.</p>
        <Link href="/" className="mt-2 inline-block font-medium text-brand-200 hover:text-white">
          Back to Buddy home
        </Link>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { workspace } = useWorkspace();

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 bg-slate-900 lg:block">
        <Sidebar />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button className="absolute inset-0 bg-slate-900/50" aria-label="Close menu" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-slate-900 shadow-xl">
            <button
              className="absolute right-3 top-4 rounded-md p-1 text-slate-400 hover:text-white"
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="sticky top-0 z-20">
        <div className="bg-amber-400 px-4 py-1.5 text-center text-xs font-medium text-amber-950">
          Demo mode: all companies, customers and messages are fictional. Nothing is connected to real services.
        </div>
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
          <button onClick={() => setMobileOpen(true)} className="rounded-md p-1 text-slate-600 hover:bg-slate-100" aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <p className="truncate text-sm font-semibold">{workspace.name}</p>
        </header>
      </div>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
    </div>
  );
}
