"use client";

import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { DemoNotice } from "@/components/ui/notice";
import { secondaryButton } from "@/components/ui/form";
import { useWorkspace } from "@/components/workspace/workspace-store";
import { urgencyLabels, urgencyOrder } from "@/lib/labels";

export function SettingsView() {
  const { workspace, teams, categories, issues, hasLocalChanges, resetDemoData } = useWorkspace();

  return (
    <>
      <PageHeader title="Workspace Settings" description={`Company-specific configuration for ${workspace.name}.`} />
      <DemoNotice>
        Settings are read-only in Phase 1. Editing the workspace, inviting colleagues and managing roles need real accounts, which
        arrive with sign-in in Phase 2.
      </DemoNotice>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Company profile">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-slate-500">Name</dt>
            <dd className="text-slate-900">{workspace.name}</dd>
            <dt className="text-slate-500">Industry</dt>
            <dd className="text-slate-900">{workspace.industry}</dd>
            <dt className="text-slate-500">Time zone</dt>
            <dd className="text-slate-900">{workspace.timezone}</dd>
            <dt className="text-slate-500">Workspace ID</dt>
            <dd className="font-mono text-xs text-slate-600">{workspace.id}</dd>
            <dt className="text-slate-500">Issues stored</dt>
            <dd className="text-slate-900">{issues.length} (demo)</dd>
          </dl>
        </Card>

        <Card title="First-response targets" description="Used for the dashboard, reports and escalation">
          <ul className="grid grid-cols-2 gap-3">
            {urgencyOrder.map((u) => (
              <li key={u} className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs text-slate-500">{urgencyLabels[u]}</p>
                <p className="text-lg font-semibold tabular-nums">{workspace.responseTargetsHours[u]} h</p>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Teams" description={`${teams.length} departments`}>
          <ul className="divide-y divide-slate-100">
            {teams.map((t) => (
              <li key={t.id} className="flex min-w-0 items-center justify-between gap-3 py-2 text-sm">
                <span className="flex shrink-0 items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.color }} />
                  {t.name}
                </span>
                <span className="min-w-0 truncate text-xs text-slate-500">
                  {t.lead} · {t.email}
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Issue categories">
          <ul className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <li key={c.id} className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700">
                {c.name}
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Members and access">
          <p className="text-sm text-slate-600">
            There are no user accounts yet, so anyone running this prototype sees both demo companies. In Phase 2 each person will
            sign in, belong to specific workspaces, and the database will block access to any other company&apos;s data.
          </p>
        </Card>

        <Card title="Demo data">
          <p className="text-sm text-slate-600">
            Status changes, routing rules and automation settings you edit are saved in this browser only.
          </p>
          <button
            className={`${secondaryButton} mt-3`}
            disabled={!hasLocalChanges}
            onClick={() => {
              if (window.confirm("Undo all your demo changes for this workspace?")) resetDemoData();
            }}
          >
            Reset demo data for this workspace
          </button>
        </Card>
      </div>
    </>
  );
}
