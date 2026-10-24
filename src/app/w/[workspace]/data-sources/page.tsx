import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth";
import { getMembershipBySlug, listImportRuns, type ImportRun } from "@/lib/data/live";
import { formatDateTimeIn } from "@/lib/format";

export const dynamic = "force-dynamic";

const statusLabels: Record<ImportRun["status"], string> = {
  running: "Not finished",
  finished: "Finished",
  failed: "Stopped with an error",
};

const sourceLabels: Record<ImportRun["source"], string> = { csv: "Spreadsheet (CSV)", gmail: "Gmail" };

export default async function DataSourcesPage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace: slug } = await params;
  const user = await requireUser(`/w/${slug}/data-sources`);
  const membership = await getMembershipBySlug(user.id, slug);
  if (!membership) notFound();

  const timeZone = membership.organization.timezone;
  const runs = await listImportRuns(membership.organization.id);

  return (
    <>
      <PageHeader
        title="Data sources"
        description="Where your issues come from, and every import into this company."
      />

      <div className="space-y-6">
        <Card title="Sources">
          <ul className="divide-y divide-slate-100 text-sm" data-testid="source-list">
            <li className="flex flex-wrap items-baseline justify-between gap-2 py-2">
              <span className="font-medium text-slate-900">Typed in</span>
              <span className="text-slate-600">Available: add an issue from the Issues tab.</span>
            </li>
            <li className="flex flex-wrap items-baseline justify-between gap-2 py-2">
              <span className="font-medium text-slate-900">Spreadsheet (CSV) import</span>
              <span className="text-slate-600">Not available yet. Coming in the next update.</span>
            </li>
            <li className="flex flex-wrap items-baseline justify-between gap-2 py-2">
              <span className="font-medium text-slate-900">Gmail</span>
              <span className="text-slate-600">Not connected. Coming in a later update.</span>
            </li>
          </ul>
        </Card>

        <Card title="Import history" description="Each import, who ran it, and what happened to its rows.">
          {runs.length === 0 ? (
            <p className="text-sm text-slate-600" data-testid="imports-empty">
              No imports yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm" data-testid="import-history">
                <thead className="text-xs text-slate-500">
                  <tr>
                    <th className="py-2 pr-4 font-medium">Started</th>
                    <th className="py-2 pr-4 font-medium">Source</th>
                    <th className="py-2 pr-4 font-medium">By</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 pr-4 text-right font-medium">Rows</th>
                    <th className="py-2 pr-4 text-right font-medium">Imported</th>
                    <th className="py-2 pr-4 text-right font-medium">Already in Buddy</th>
                    <th className="py-2 text-right font-medium">Rejected</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {runs.map((run) => (
                    <tr key={run.id} data-testid="import-row" className="align-top">
                      <td className="py-2 pr-4 whitespace-nowrap text-slate-900">
                        {formatDateTimeIn(run.startedAt, timeZone)}
                      </td>
                      <td className="py-2 pr-4 text-slate-900">
                        {sourceLabels[run.source]}
                        {run.fileName && <span className="block text-xs text-slate-500">{run.fileName}</span>}
                      </td>
                      <td className="py-2 pr-4 text-slate-600">{run.startedByName ?? "Former member"}</td>
                      <td className="py-2 pr-4 text-slate-600">
                        {statusLabels[run.status]}
                        {run.error && <span className="block text-xs text-red-700">{run.error}</span>}
                        {run.problems.length > 0 && (
                          <details className="mt-1 text-xs">
                            <summary className="cursor-pointer text-slate-500">Why rows were rejected</summary>
                            <ul className="mt-1 space-y-0.5">
                              {run.problems.map((p, i) => (
                                <li key={i}>
                                  {p.row ? `Row ${p.row}: ` : ""}
                                  {p.reason}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-right text-slate-900">{run.rowsExamined}</td>
                      <td className="py-2 pr-4 text-right text-slate-900">{run.imported}</td>
                      <td className="py-2 pr-4 text-right text-slate-900">{run.skippedDuplicate}</td>
                      <td className="py-2 text-right text-slate-900">{run.rejected}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
