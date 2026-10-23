"use client";

import { useRouter } from "next/navigation";

export function WorkspaceSwitcher({ current, options }: { current: string; options: { slug: string; name: string }[] }) {
  const router = useRouter();
  return (
    <>
      <label htmlFor="workspace-switcher" className="sr-only">
        Workspace
      </label>
      <select
        id="workspace-switcher"
        value={current}
        onChange={(e) => router.push(e.target.value === "__new" ? "/onboarding" : `/w/${e.target.value}`)}
        className="max-w-[14rem] rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900"
      >
        {options.map((o) => (
          <option key={o.slug} value={o.slug}>
            {o.name}
          </option>
        ))}
        <option value="__new">+ New workspace</option>
      </select>
    </>
  );
}
