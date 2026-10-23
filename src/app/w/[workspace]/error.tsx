"use client";

import { startTransition } from "react";
import { useRouter } from "next/navigation";
import { primaryButton } from "@/components/ui/form";

// Shown when loading a workspace page fails, for example if the database
// can't be reached. The technical details stay in the server log.
export default function WorkspaceError({ reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-white p-6 text-center shadow-sm">
      <p className="text-sm font-medium text-slate-900">Something went wrong loading this page.</p>
      <p className="mt-1 text-sm text-slate-500">Check your internet connection and try again.</p>
      <button
        type="button"
        onClick={() =>
          startTransition(() => {
            router.refresh();
            reset();
          })
        }
        className={`${primaryButton} mt-4`}
      >
        Try again
      </button>
    </div>
  );
}
