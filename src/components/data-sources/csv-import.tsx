"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { finishCsvImport, importCsvChunk, startCsvImport, type RowOutcome } from "@/app/actions/imports";
import { FormMessage } from "@/components/auth/auth-card";
import { Field, inputClass, primaryButton, secondaryButton } from "@/components/ui/form";
import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  buildImportRows,
  chunkRows,
  dateOrderLabels,
  guessDateOrder,
  guessMapping,
  importFieldLabels,
  importFields,
  parseCsv,
  requiredImportFields,
  rowProblem,
  type ColumnMapping,
  type DateOrder,
  type ImportField,
} from "@/lib/csv-import";
import { channelLabels } from "@/lib/labels";
import type { Channel } from "@/lib/types";

// "Import a CSV file" on the Data sources page (owners and admins). The file is
// read here in the browser and never uploaded as a file: only the rows are
// sent, in pieces, and the database checks each one again. Results come from
// what the database reports for each row, never from this page's preview.

const PREVIEW_ROWS = 10;

interface LoadedFile {
  name: string;
  headings: string[];
  lines: string[][];
}

interface Result {
  imported: number;
  duplicate: number;
  rejected: { row: number | null; reason: string }[];
  /** Set when the import stopped part-way. */
  error?: string;
}

const numberFormat = new Intl.NumberFormat("en-GB");
const n = (value: number) => numberFormat.format(value);

export function CsvImport({ organizationId, timeZone, slug }: { organizationId: string; timeZone: string; slug: string }) {
  const router = useRouter();
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [fileError, setFileError] = useState<string>();
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [dateOrder, setDateOrder] = useState<DateOrder>("ymd");
  const [defaultChannel, setDefaultChannel] = useState<Channel>("email");
  const [kind, setKind] = useState<"open" | "history" | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [inputKey, setInputKey] = useState(0);

  const importing = progress !== null;

  // Leaving the page part-way would leave the import unfinished.
  useEffect(() => {
    if (!importing) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [importing]);

  const rows = useMemo(
    () => (file && mapping ? buildImportRows(file.lines, mapping, { dateOrder, timeZone, defaultChannel }) : []),
    [file, mapping, dateOrder, timeZone, defaultChannel],
  );
  const problems = useMemo(() => {
    const now = new Date();
    return rows.map((row) => rowProblem(row, now));
  }, [rows]);
  const problemCount = problems.filter(Boolean).length;
  const missing = mapping ? requiredImportFields.filter((f) => mapping[f] === null) : [];

  function reset() {
    setFile(null);
    setMapping(null);
    setKind(null);
    setResult(null);
    setFileError(undefined);
    setInputKey((k) => k + 1);
  }

  async function onFile(selected: File | undefined) {
    setResult(null);
    setFileError(undefined);
    setFile(null);
    setMapping(null);
    setKind(null);
    if (!selected) return;
    if (selected.size > MAX_IMPORT_BYTES) {
      setFileError("This file is larger than 5 MB. Split it into smaller files and import them one at a time.");
      return;
    }
    let text: string;
    try {
      text = await selected.text();
    } catch {
      setFileError("This file could not be read. Save it again as CSV and try once more.");
      return;
    }
    const all = parseCsv(text);
    if (all.length < 2) {
      setFileError("This file has no rows under the heading row. Check that it is a CSV file with headings in row 1.");
      return;
    }
    const [headings, ...lines] = all;
    if (lines.length > MAX_IMPORT_ROWS) {
      setFileError(
        `This file has ${n(lines.length)} rows. Buddy imports up to ${n(MAX_IMPORT_ROWS)} at a time: split it into smaller files.`,
      );
      return;
    }
    const guessed = guessMapping(headings);
    setFile({ name: selected.name, headings: headings.map((h) => h.trim()), lines });
    setMapping(guessed);
    setDateOrder(guessDateOrder(guessed.receivedAt === null ? [] : lines.map((l) => l[guessed.receivedAt!] ?? "")));
  }

  function setColumn(field: ImportField, value: string) {
    if (!mapping) return;
    const column = value === "" ? null : Number(value);
    const next = { ...mapping, [field]: column };
    // A column belongs to one field only.
    if (column !== null) {
      for (const other of importFields) if (other !== field && next[other] === column) next[other] = null;
    }
    setMapping(next);
    if (field === "receivedAt" && column !== null && file) {
      setDateOrder(guessDateOrder(file.lines.map((l) => l[column] ?? "")));
    }
  }

  async function runImport() {
    if (!file || !kind || rows.length === 0) return;
    setResult(null);
    setProgress({ done: 0, total: rows.length });
    const started = await startCsvImport(organizationId, file.name);
    if ("error" in started) {
      setProgress(null);
      setResult({ imported: 0, duplicate: 0, rejected: [], error: started.error });
      return;
    }
    const totals: Result = { imported: 0, duplicate: 0, rejected: [] };
    let done = 0;
    let failure: string | undefined;
    for (const chunk of chunkRows(rows)) {
      let answer: Awaited<ReturnType<typeof importCsvChunk>>;
      try {
        answer = await importCsvChunk(started.runId, chunk, kind === "history");
      } catch {
        answer = { error: "The connection to Buddy was lost." };
      }
      if ("error" in answer) {
        failure = answer.error;
        break;
      }
      for (const o of answer.outcomes as RowOutcome[]) {
        if (o.outcome === "imported") totals.imported++;
        else if (o.outcome === "duplicate") totals.duplicate++;
        else totals.rejected.push({ row: o.row, reason: o.reason ?? "Rejected." });
      }
      done += chunk.length;
      setProgress({ done, total: rows.length });
    }
    let closed: { error?: string };
    try {
      closed = await finishCsvImport(
        started.runId,
        failure ? `Stopped after ${done} of ${rows.length} rows: ${failure}`.slice(0, 500) : null,
      );
    } catch {
      closed = { error: "The connection to Buddy was lost." };
    }
    setProgress(null);
    if (failure) {
      totals.error = `The import stopped after ${n(done)} of ${n(rows.length)} rows: ${failure} The rows counted below were saved.`;
    } else if (closed.error) {
      totals.error = `Every row was sent, but the import could not be closed: ${closed.error}`;
    }
    setResult(totals);
    setFile(null);
    setMapping(null);
    setKind(null);
    setInputKey((k) => k + 1);
    router.refresh();
  }

  if (result) {
    return (
      <div className="space-y-4" data-testid="import-result">
        {result.error ? (
          <FormMessage error={result.error} />
        ) : (
          <FormMessage success="Import finished." />
        )}
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="text-slate-500">Imported</dt>
          <dd className="text-slate-900" data-testid="result-imported">
            {n(result.imported)}
          </dd>
          <dt className="text-slate-500">Already in Buddy (skipped)</dt>
          <dd className="text-slate-900" data-testid="result-duplicate">
            {n(result.duplicate)}
          </dd>
          <dt className="text-slate-500">Rejected</dt>
          <dd className="text-slate-900" data-testid="result-rejected">
            {n(result.rejected.length)}
          </dd>
        </dl>
        {result.rejected.length > 0 && (
          <div>
            <p className="text-xs font-medium text-slate-600">Rejected rows</p>
            <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto text-xs text-slate-700">
              {result.rejected.slice(0, 200).map((p, i) => (
                <li key={i}>
                  {p.row ? `Row ${p.row}: ` : ""}
                  {p.reason}
                </li>
              ))}
              {result.rejected.length > 200 && <li>…and {n(result.rejected.length - 200)} more.</li>}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {result.imported > 0 && (
            <Link href={`/w/${slug}/issues`} className={primaryButton}>
              Open the Issues list
            </Link>
          )}
          <button type="button" className={secondaryButton} onClick={reset}>
            Import another file
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ol className="list-decimal space-y-1 pl-5 text-xs text-slate-600">
        <li>
          In Excel, put headings in row 1 and one customer message per row. Needed: customer name, message, and when it
          was received. Optional: ID, email, channel, subject.
        </li>
        <li>Save it with File &gt; Save As &gt; &ldquo;CSV UTF-8 (Comma delimited)&rdquo;.</li>
        <li>Choose the file below, check the preview, then import. Up to {n(MAX_IMPORT_ROWS)} rows per file.</li>
      </ol>

      <Field label="CSV file">
        <input
          key={inputKey}
          type="file"
          accept=".csv,text/csv"
          disabled={importing}
          onChange={(e) => onFile(e.target.files?.[0])}
          className="block text-sm text-slate-700 file:mr-3 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-50"
          data-testid="csv-file"
        />
      </Field>
      {fileError && <FormMessage error={fileError} />}

      {file && mapping && (
        <>
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">
              Match the columns{" "}
              <span className="font-normal text-slate-500">
                ({file.name}, {n(file.lines.length)} rows)
              </span>
            </h3>
            <p className="text-xs text-slate-500">
              Buddy guessed from the headings. Change any that are wrong.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {importFields.map((field) => (
                <Field
                  key={field}
                  label={`${importFieldLabels[field]}${requiredImportFields.includes(field) ? " (needed)" : ""}`}
                  hint={
                    field === "subject" && mapping.subject === null
                      ? "None: Buddy uses the first words of the message."
                      : field === "recordId" && mapping.recordId === null
                        ? "None: Buddy spots repeats by name, time and message."
                        : field === "channel" && mapping.channel === null
                          ? "None: every row uses the channel chosen below."
                          : undefined
                  }
                >
                  <select
                    className={inputClass}
                    value={mapping[field] ?? ""}
                    onChange={(e) => setColumn(field, e.target.value)}
                    disabled={importing}
                    data-testid={`map-${field}`}
                  >
                    <option value="">(none)</option>
                    {file.headings.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Column ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </Field>
              ))}
              <Field label="Dates are written as" hint={`Times without a time zone are read as ${timeZone} time.`}>
                <select
                  className={inputClass}
                  value={dateOrder}
                  onChange={(e) => setDateOrder(e.target.value as DateOrder)}
                  disabled={importing}
                  data-testid="date-order"
                >
                  {(Object.keys(dateOrderLabels) as DateOrder[]).map((o) => (
                    <option key={o} value={o}>
                      {dateOrderLabels[o]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Channel when a row has none">
                <select
                  className={inputClass}
                  value={defaultChannel}
                  onChange={(e) => setDefaultChannel(e.target.value as Channel)}
                  disabled={importing}
                  data-testid="default-channel"
                >
                  {(Object.keys(channelLabels) as Channel[]).map((c) => (
                    <option key={c} value={c}>
                      {channelLabels[c]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {missing.length > 0 && (
              <FormMessage error={`Choose a column for: ${missing.map((f) => importFieldLabels[f]).join(", ")}.`} />
            )}
          </section>

          {missing.length === 0 && (
            <>
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-900">Preview</h3>
                <p className="text-sm text-slate-700" data-testid="preview-summary">
                  {n(rows.length - problemCount)} of {n(rows.length)} rows look ready.
                  {problemCount > 0 && ` ${n(problemCount)} will be rejected (reasons below).`} Rows already in Buddy
                  are skipped when you import.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs" data-testid="preview-table">
                    <thead className="text-slate-500">
                      <tr>
                        <th className="py-1 pr-3 font-medium">Row</th>
                        <th className="py-1 pr-3 font-medium">Customer</th>
                        <th className="py-1 pr-3 font-medium">Subject</th>
                        <th className="py-1 pr-3 font-medium">Received</th>
                        <th className="py-1 pr-3 font-medium">Channel</th>
                        <th className="py-1 font-medium">Problem</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rows.slice(0, PREVIEW_ROWS).map((row, i) => (
                        <tr key={row.row} data-testid="preview-row" className="align-top">
                          <td className="py-1 pr-3 text-slate-500">{row.row}</td>
                          <td className="py-1 pr-3 text-slate-900">
                            {row.customer_name}
                            {row.customer_email && <span className="block text-slate-500">{row.customer_email}</span>}
                          </td>
                          <td className="max-w-56 py-1 pr-3 break-words text-slate-900">{row.subject}</td>
                          <td className="py-1 pr-3 whitespace-nowrap text-slate-700">
                            {row.received_at && !Number.isNaN(Date.parse(row.received_at))
                              ? new Intl.DateTimeFormat("en-GB", {
                                  dateStyle: "medium",
                                  timeStyle: "short",
                                  timeZone,
                                }).format(new Date(row.received_at))
                              : ""}
                          </td>
                          <td className="py-1 pr-3 text-slate-700">
                            {channelLabels[row.channel as Channel] ?? row.channel}
                          </td>
                          <td className="py-1 text-red-700">{problems[i] ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {rows.length > PREVIEW_ROWS && (
                  <p className="text-xs text-slate-500">Showing the first {PREVIEW_ROWS} rows.</p>
                )}
                {problemCount > 0 && (
                  <details className="text-xs" data-testid="preview-problems">
                    <summary className="cursor-pointer text-slate-600">Rows that will be rejected</summary>
                    <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto text-slate-700">
                      {rows.map((row, i) =>
                        problems[i] ? (
                          <li key={row.row}>
                            Row {row.row}: {problems[i]}
                          </li>
                        ) : null,
                      )}
                    </ul>
                  </details>
                )}
              </section>

              <fieldset className="space-y-2">
                <legend className="text-sm font-semibold text-slate-900">What are these rows?</legend>
                <label className="flex items-start gap-2 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="importKind"
                    className="mt-1"
                    checked={kind === "open"}
                    onChange={() => setKind("open")}
                    disabled={importing}
                  />
                  <span>
                    <span className="font-medium text-slate-900">Open issues</span>
                    <span className="block text-xs text-slate-500">
                      Saved as New, with deadlines counted from when each was received. Old ones may show as overdue
                      straight away.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="importKind"
                    className="mt-1"
                    checked={kind === "history"}
                    onChange={() => setKind("history")}
                    disabled={importing}
                  />
                  <span>
                    <span className="font-medium text-slate-900">Past conversations, already resolved</span>
                    <span className="block text-xs text-slate-500">
                      Saved as Resolved at the time they were received, so they never count as missed targets or
                      escalations.
                    </span>
                  </span>
                </label>
              </fieldset>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className={primaryButton}
                  disabled={importing || !kind || rows.length === problemCount}
                  onClick={runImport}
                >
                  {importing ? "Importing…" : `Import ${n(rows.length - problemCount)} rows`}
                </button>
                {!importing && (
                  <button type="button" className={secondaryButton} onClick={reset}>
                    Cancel
                  </button>
                )}
                {progress && (
                  <span className="text-sm text-slate-600" role="status">
                    Saved {n(progress.done)} of {n(progress.total)} rows. Keep this page open.
                  </span>
                )}
                {!kind && !importing && <span className="text-xs text-slate-500">Choose what these rows are first.</span>}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
