"use client";

import { FileSpreadsheet, Globe, Headphones, Mail, MessageCircle, MessagesSquare, Smartphone, Star, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { DemoNotice } from "@/components/ui/notice";
import type { DataSourceDefinition, DataSourceKind } from "@/lib/types";

const icons: Record<DataSourceKind, LucideIcon> = {
  csv_upload: FileSpreadsheet,
  email_inbox: Mail,
  helpdesk: Headphones,
  live_chat: MessagesSquare,
  app_store: Smartphone,
  review_site: Star,
  survey: MessageCircle,
  social: Globe,
};

export function DataSourcesView({ catalog }: { catalog: DataSourceDefinition[] }) {
  return (
    <>
      <PageHeader
        title="Data Sources"
        description="Where customer messages will come from. Each source needs a supported integration and permission from your company."
      />
      <DemoNotice>
        <strong>Nothing is connected.</strong> The issues you see in this demo are fictional and built into the app. Typing a company
        name never gives Buddy access to that company&apos;s reviews, social accounts or support tickets. Every connection will require
        an administrator of that system to approve it.
      </DemoNotice>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {catalog.map((source) => {
          const Icon = icons[source.kind];
          return (
            <Card key={source.kind}>
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                  <Icon className="h-5 w-5" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold text-slate-900">{source.name}</h2>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">Not connected</span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{source.description}</p>
                  <p className="mt-2 text-xs text-slate-500">Examples: {source.examples}</p>
                </div>
              </div>
              <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                <p className="font-medium text-slate-700">Permission needed</p>
                <p className="mt-0.5">{source.authorization}</p>
              </div>
              <button disabled className="mt-4 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-400">
                Available in Phase {source.plannedPhase}
              </button>
            </Card>
          );
        })}
      </div>
    </>
  );
}
