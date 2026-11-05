import { notFound } from "next/navigation";
import { FormMessage } from "@/components/auth/auth-card";
import { CsvImport } from "@/components/data-sources/csv-import";
import { GmailDisconnect } from "@/components/data-sources/gmail-disconnect";
import { GmailFetch } from "@/components/data-sources/gmail-fetch";
import { ImportAiButton } from "@/components/data-sources/import-ai-button";
import { PlayConnect, PlayDisconnect } from "@/components/data-sources/play-connect";
import { PlayFetch } from "@/components/data-sources/play-fetch";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth";
import { getMailboxConnection, getMembershipBySlug, getPlayConnection, listImportRuns, type ImportRun } from "@/lib/data/live";
import { gmailStatus } from "@/lib/gmail";
import { playMode } from "@/lib/play";
import { gmailResultMessages } from "@/lib/gmail/oauth";
import { formatDateTimeIn } from "@/lib/format";
import { primaryButton } from "@/components/ui/form";

export const dynamic = "force-dynamic";

const statusLabels: Record<ImportRun["status"], string> = {
  running: "Not finished",
  finished: "Finished",
  failed: "Stopped with an error",
};

const sourceLabels: Record<ImportRun["source"], string> = {
  csv: "Spreadsheet (CSV)",
  gmail: "Gmail",
  google_play: "Google Play reviews",
};

export default async function DataSourcesPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ gmail?: string; play?: string }>;
}) {
  const { workspace: slug } = await params;
  const { gmail: gmailResult, play: playResult } = await searchParams;
  const user = await requireUser(`/w/${slug}/data-sources`);
  const membership = await getMembershipBySlug(user.id, slug);
  if (!membership) notFound();

  const timeZone = membership.organization.timezone;
  const [runs, mailbox, playRead] = await Promise.all([
    listImportRuns(membership.organization.id),
    getMailboxConnection(membership.organization.id),
    // If Google Play can't be read (for example its database change hasn't
    // been applied yet), the rest of the page still loads and the card says so.
    getPlayConnection(membership.organization.id).catch(() => "unavailable" as const),
  ]);
  const playUnavailable = playRead === "unavailable";
  const play = playUnavailable ? null : playRead;
  const gmailService = gmailStatus();
  const playService = playMode();
  // Shown only when the database agrees, whatever the address bar says.
  const playMessage =
    playResult === "connected" && play
      ? `Google Play connected: ${play.packageName}.`
      : playResult === "disconnected" && !play
        ? "Google Play disconnected. Buddy deleted the saved key. To be sure, you can also delete the key in Google Cloud."
        : null;
  const isOwner = membership.role === "owner";
  // "Connected" is shown only when the connection is really there, whatever the address bar says.
  const gmailMessage =
    gmailResult === "connected"
      ? mailbox
        ? { success: `Gmail connected: ${mailbox.emailAddress}.` }
        : { error: gmailResultMessages.save_failed }
      : gmailResult === "disconnected" || gmailResult === "disconnected_local"
        ? mailbox
          ? null
          : {
              success:
                gmailResult === "disconnected"
                  ? "Gmail disconnected. Google has cancelled Buddy's access."
                  : "Gmail disconnected in Buddy, but Google could not be told. Remove Buddy at myaccount.google.com/permissions to be sure.",
            }
        : gmailResult && gmailResultMessages[gmailResult]
        ? { error: gmailResultMessages[gmailResult] }
        : null;
  // Only decides whether to show the import box; the database refuses imports from members.
  const canImport = membership.role === "owner" || membership.role === "admin";

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
              <span className="text-slate-600">Available: owners and admins import a file below.</span>
            </li>
            <li className="flex flex-wrap items-baseline justify-between gap-2 py-2">
              <span className="font-medium text-slate-900">Gmail</span>
              <span className="text-slate-600" data-testid="gmail-source-status">
                {mailbox ? `Connected: ${mailbox.emailAddress} (read-only)` : "Not connected."}
              </span>
            </li>
            <li className="flex flex-wrap items-baseline justify-between gap-2 py-2">
              <span className="font-medium text-slate-900">Google Play reviews</span>
              <span className="text-slate-600" data-testid="play-source-status">
                {playUnavailable
                  ? "Not available yet."
                  : play
                    ? `Connected: ${play.packageName} (read-only)`
                    : "Not connected."}
              </span>
            </li>
          </ul>
        </Card>

        <Card
          title="Gmail inbox"
          description="Read-only: Buddy can read messages but can never send, delete or change email. One inbox per company."
        >
          <div className="space-y-4 text-sm" data-testid="gmail-card">
            {gmailMessage && <FormMessage {...gmailMessage} />}
            {mailbox ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
                <dt className="text-slate-500">Inbox</dt>
                <dd className="break-all text-slate-900" data-testid="gmail-address">
                  {mailbox.emailAddress}
                </dd>
                <dt className="text-slate-500">Connected</dt>
                <dd className="text-slate-900">
                  {formatDateTimeIn(mailbox.connectedAt, timeZone)}
                  {mailbox.connectedByName && ` by ${mailbox.connectedByName}`}
                </dd>
                <dt className="text-slate-500">Last fetched</dt>
                <dd className="text-slate-900" data-testid="gmail-last-fetched">
                  {mailbox.lastFetchedAt ? formatDateTimeIn(mailbox.lastFetchedAt, timeZone) : "Never"}
                </dd>
              </dl>
            ) : (
              <p className="text-slate-600" data-testid="gmail-not-connected">
                No inbox connected.
              </p>
            )}
            {mailbox &&
              (canImport ? (
                gmailService === "not_configured" ? (
                  <p className="text-xs text-slate-500">
                    Fetching needs GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GMAIL_TOKEN_KEY in .env.local on this server.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-slate-500">
                      Fetch reads new emails in the inbox since the last fetch (the first time, the last 7 days), up to 50
                      at a time, and adds each as an issue. Emails sent from the inbox are left out, and nothing in Gmail
                      changes. Use a test inbox with made-up emails until Buddy is ready for real customer data.
                    </p>
                    <GmailFetch organizationId={membership.organization.id} />
                  </div>
                )
              ) : (
                <p className="text-xs text-slate-500" data-testid="gmail-fetch-not-allowed">
                  Owners and admins can fetch new email.
                </p>
              ))}
            {gmailService === "not_configured" && !mailbox ? (
              <p className="text-xs text-slate-500" data-testid="gmail-not-configured">
                Gmail is not set up on this server yet: add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GMAIL_TOKEN_KEY to
                .env.local (see the README).
              </p>
            ) : isOwner ? (
              mailbox ? (
                <GmailDisconnect organizationId={membership.organization.id} slug={slug} />
              ) : (
                <div className="space-y-2">
                  <a
                    href={`/api/gmail/connect?workspace=${slug}`}
                    className={primaryButton}
                    data-testid="gmail-connect"
                  >
                    Connect Gmail
                  </a>
                  <p className="text-xs text-slate-500">
                    Google asks you to sign in and allow read-only access. Use a test inbox with made-up emails until Buddy
                    is ready for real customer data.
                  </p>
                </div>
              )
            ) : (
              <p className="text-xs text-slate-500" data-testid="gmail-owner-only">
                Only owners can connect or disconnect the inbox.
              </p>
            )}
          </div>
        </Card>

        <Card
          title="Google Play reviews"
          description="Read-only: Buddy lists your app's reviews but can never reply to or change them. One app per company."
        >
          <div className="space-y-4 text-sm" data-testid="play-card">
            {playUnavailable ? (
              <p className="text-slate-600" data-testid="play-unavailable">
                Google Play can&apos;t be used yet: its database change hasn&apos;t been applied to this Supabase project
                (run <code>npx.cmd supabase db push</code>, see the README).
              </p>
            ) : (
              <>
                {playMessage && <FormMessage success={playMessage} />}
                {playService === "fake" && (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800" data-testid="play-test-mode">
                    Test mode: a pretend Google Play with made-up reviews. Any correctly shaped key works, and nothing
                    contacts Google.
                  </p>
                )}
                {play ? (
                  <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
                    <dt className="text-slate-500">App</dt>
                    <dd className="break-all text-slate-900" data-testid="play-package">
                      {play.packageName}
                    </dd>
                    <dt className="text-slate-500">Service account</dt>
                    <dd className="break-all text-slate-900">{play.accountEmail}</dd>
                    <dt className="text-slate-500">Connected</dt>
                    <dd className="text-slate-900">
                      {formatDateTimeIn(play.connectedAt, timeZone)}
                      {play.connectedByName && ` by ${play.connectedByName}`}
                    </dd>
                    <dt className="text-slate-500">Last fetched</dt>
                    <dd className="text-slate-900" data-testid="play-last-fetched">
                      {play.lastFetchedAt ? formatDateTimeIn(play.lastFetchedAt, timeZone) : "Never"}
                    </dd>
                  </dl>
                ) : (
                  <p className="text-slate-600" data-testid="play-not-connected">
                    No app connected.
                  </p>
                )}
                {play &&
                  (canImport ? (
                    playService === "off" ? (
                      <p className="text-xs text-slate-500" data-testid="play-off">
                        Fetching is switched off on this server.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-xs text-slate-500">
                          Fetch adds each review with text as an issue (channel App review). Google only shares reviews
                          written or changed in about the last 7 days, so fetch at least once a week. Reviews already in
                          Buddy are skipped, and nothing on Google Play changes.
                        </p>
                        <PlayFetch organizationId={membership.organization.id} />
                      </div>
                    )
                  ) : (
                    <p className="text-xs text-slate-500" data-testid="play-fetch-not-allowed">
                      Owners and admins can fetch new reviews.
                    </p>
                  ))}
                {isOwner ? (
                  play ? (
                    <PlayDisconnect organizationId={membership.organization.id} slug={slug} />
                  ) : playService === "off" ? (
                    <p className="text-xs text-slate-500" data-testid="play-off">
                      Connecting Google Play is switched off on this server. A real app brings in real customer reviews, which
                      Buddy isn&apos;t approved for yet.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs text-slate-500">
                        You need your company&apos;s own Google Play Console and a Google Cloud service account with access to
                        the app. The README section &quot;Google Play reviews&quot; has the steps. Buddy never asks for your
                        Google password.
                      </p>
                      <PlayConnect organizationId={membership.organization.id} slug={slug} />
                    </div>
                  )
                ) : (
                  <p className="text-xs text-slate-500" data-testid="play-owner-only">
                    Only owners can connect or disconnect Google Play.
                  </p>
                )}
              </>
            )}
          </div>
        </Card>

        <Card
          title="Import a CSV file"
          description="Adds customer messages from a spreadsheet. Use made-up customers until Buddy is ready for real data."
        >
          {canImport ? (
            <CsvImport organizationId={membership.organization.id} timeZone={timeZone} slug={slug} />
          ) : (
            <p className="text-sm text-slate-600" data-testid="import-not-allowed">
              Only owners and admins can import files.
            </p>
          )}
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
                    {canImport && <th className="py-2 pl-4 font-medium">AI</th>}
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
                      {canImport && (
                        <td className="py-2 pl-4">
                          {run.imported > 0 && run.status !== "running" && <ImportAiButton runId={run.id} compact />}
                        </td>
                      )}
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
