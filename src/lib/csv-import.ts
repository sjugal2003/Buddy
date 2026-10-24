import { zonedTimeToUtc } from "@/lib/dashboard";
import type { Channel } from "@/lib/types";

// CSV import, the part that runs in the browser: reading the file, guessing
// which column is which, and turning each line into a row for
// public.import_issues. Pure functions, so the preview and the tests agree.
// The database checks every row again; the checks here only let people see
// problems before anything is saved, and give the same reasons.

/** At most this many rows (not counting the heading row) per file. */
export const MAX_IMPORT_ROWS = 5000;
/** Larger files are refused before they are read. */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
/** Rows sent per request; the database takes at most 500. */
export const IMPORT_CHUNK_ROWS = 500;
/** Keeps each request well under the server's 1 MB limit. */
export const IMPORT_CHUNK_BYTES = 700_000;

// Same limits as the database (supabase/migrations/20261026090000_import_foundation.sql).
const LIMITS = { name: 120, subject: 200, message: 10000, email: 254, recordId: 200 } as const;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const importFields = [
  "recordId",
  "customerName",
  "customerEmail",
  "channel",
  "subject",
  "message",
  "receivedAt",
] as const;
export type ImportField = (typeof importFields)[number];

export const importFieldLabels: Record<ImportField, string> = {
  recordId: "ID",
  customerName: "Customer name",
  customerEmail: "Customer email",
  channel: "Channel",
  subject: "Subject",
  message: "Message",
  receivedAt: "Received time",
};

/** Fields that need a column. Subject falls back to the message's first words. */
export const requiredImportFields: ImportField[] = ["customerName", "message", "receivedAt"];

/** Column number for each field, or null when the file has none. */
export type ColumnMapping = Record<ImportField, number | null>;

export type DateOrder = "ymd" | "dmy" | "mdy";

export const dateOrderLabels: Record<DateOrder, string> = {
  ymd: "Year-month-day (2026-10-20)",
  dmy: "Day/month/year (20/10/2026)",
  mdy: "Month/day/year (10/20/2026)",
};

/** One row as public.import_issues takes it. */
export interface ImportRow {
  row: number;
  record_id: string;
  customer_name: string;
  customer_email: string;
  channel: string;
  subject: string;
  message: string;
  received_at: string | null;
}

/**
 * Reads CSV text into rows of cells: quoted cells, "" inside quotes, line
 * breaks inside quotes, CRLF, a byte-order mark, and comma, semicolon or tab
 * as the separator (whichever the first line uses most).
 */
export function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const delimiter = detectDelimiter(input);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // Blank lines (often at the end of a file) are not rows.
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function detectDelimiter(text: string) {
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) break;
    else if (!quoted && ch in counts) counts[ch]++;
  }
  const [best, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return count > 0 ? best : ",";
}

// Heading names people use, written without spaces, dashes or capitals.
const HEADINGS: Record<ImportField, string[]> = {
  recordId: ["id", "recordid", "ticketid", "ticket", "ticketnumber", "ticketno", "reference", "ref", "messageid", "conversationid", "caseid", "caseno"],
  customerName: ["customername", "name", "customer", "fromname", "from", "contact", "contactname", "requester", "requestername", "sender", "author", "fullname"],
  customerEmail: ["customeremail", "email", "emailaddress", "mail", "fromemail", "requesteremail", "contactemail", "senderemail"],
  channel: ["channel", "source", "via", "medium"],
  subject: ["subject", "title", "topic", "headline"],
  message: ["message", "body", "text", "description", "comment", "comments", "content", "details", "feedback", "review", "messagebody"],
  receivedAt: ["receivedat", "received", "datereceived", "receivedtime", "date", "datetime", "createdat", "created", "createddate", "timestamp", "time", "sentat", "submittedat", "submitted"],
};

const normalise = (heading: string) => heading.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Guesses each field's column from the heading row. Each column is used once. */
export function guessMapping(headings: string[]): ColumnMapping {
  const names = headings.map(normalise);
  const used = new Set<number>();
  const mapping = Object.fromEntries(importFields.map((f) => [f, null])) as ColumnMapping;
  // Earlier names in each list are better matches, so try them first across all fields.
  const longest = Math.max(...Object.values(HEADINGS).map((list) => list.length));
  for (let rank = 0; rank < longest; rank++) {
    for (const field of importFields) {
      const wanted = HEADINGS[field][rank];
      if (mapping[field] !== null || !wanted) continue;
      const column = names.findIndex((n, i) => n === wanted && !used.has(i));
      if (column >= 0) {
        mapping[field] = column;
        used.add(column);
      }
    }
  }
  return mapping;
}

/** Turns a channel cell into Buddy's channel; anything unknown is kept as typed so it is rejected. */
export function parseChannel(value: string, fallback: Channel): string {
  const v = value.toLowerCase().replace(/[^a-z]/g, "");
  if (v === "") return fallback;
  if (["email", "mail", "gmail", "outlook"].includes(v)) return "email";
  if (["chat", "livechat", "webchat", "messenger", "whatsapp"].includes(v)) return "live_chat";
  if (["review", "appreview", "appstore", "playstore", "googleplay"].includes(v)) return "app_review";
  if (["survey", "nps", "csat", "form", "feedbackform"].includes(v)) return "survey";
  if (["social", "twitter", "x", "facebook", "instagram", "linkedin", "socialmedia"].includes(v)) return "social";
  if (["phone", "call", "phonecall", "voice", "phonetranscript", "calltranscript"].includes(v)) return "phone_transcript";
  return value.trim();
}

const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/i;
const YMD = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?)?$/i;
const XXY = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[T ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?)?$/i;

/**
 * Reads a received time. Times without a time zone are the company's local
 * time. Returns an ISO string, or null when the cell cannot be read as a date.
 */
export function parseReceivedAt(value: string, order: DateOrder, timeZone: string): string | null {
  const v = value.trim();
  if (ISO_WITH_ZONE.test(v)) {
    const ms = Date.parse(v.replace(" ", "T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  }
  let parts: string[] | null = null;
  let y: number, m: number, d: number;
  const ymd = YMD.exec(v);
  const xxy = ymd ? null : XXY.exec(v);
  if (ymd) {
    parts = ymd;
    [y, m, d] = [Number(ymd[1]), Number(ymd[2]), Number(ymd[3])];
  } else if (xxy && order !== "ymd") {
    parts = xxy;
    const [a, b] = [Number(xxy[1]), Number(xxy[2])];
    [d, m] = order === "dmy" ? [a, b] : [b, a];
    y = Number(xxy[3]);
  } else {
    return null;
  }
  let hour = parts[4] ? Number(parts[4]) : 0;
  const minute = parts[5] ? Number(parts[5]) : 0;
  const second = parts[6] ? Number(parts[6]) : 0;
  const ampm = parts[7]?.toLowerCase().replace(/\./g, "");
  if (ampm) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (ampm === "pm" ? 12 : 0);
  }
  if (m < 1 || m > 12 || d < 1 || hour > 23 || minute > 59 || second > 59) return null;
  // Refuses dates such as 31 February.
  if (new Date(Date.UTC(y, m - 1, d)).getUTCDate() !== d) return null;
  return zonedTimeToUtc(y, m, d, hour, minute, second, timeZone).toISOString();
}

/** Picks the date order from the values: a first part above 12 means day first, a second part above 12 month first. */
export function guessDateOrder(values: string[]): DateOrder {
  let dayFirst = false;
  let monthFirst = false;
  let slashDates = 0;
  for (const value of values) {
    const match = XXY.exec(value.trim());
    if (!match) continue;
    slashDates++;
    if (Number(match[1]) > 12) dayFirst = true;
    if (Number(match[2]) > 12) monthFirst = true;
  }
  if (slashDates === 0) return "ymd";
  if (monthFirst && !dayFirst) return "mdy";
  return "dmy";
}

export interface BuildOptions {
  dateOrder: DateOrder;
  timeZone: string;
  defaultChannel: Channel;
}

/** Words from the start of the message, for files without a subject column. */
function subjectFromMessage(message: string) {
  const oneLine = message.replace(/\s+/g, " ").trim();
  if (oneLine.length <= 80) return oneLine;
  const cut = oneLine.slice(0, 80);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : 80)}…`;
}

// Longer values are rejected by the database anyway; sending only one
// character over the limit keeps each request small and the reason the same.
const clip = (value: string, limit: number) => (value.length > limit + 1 ? value.slice(0, limit + 1) : value);

/** Turns the file's data lines (after the heading row) into rows for the database. */
export function buildImportRows(lines: string[][], mapping: ColumnMapping, options: BuildOptions): ImportRow[] {
  const cell = (line: string[], field: ImportField) => {
    const column = mapping[field];
    return column === null ? "" : (line[column] ?? "").trim();
  };
  return lines.map((line, index) => {
    const message = cell(line, "message");
    const received = cell(line, "receivedAt");
    const parsed = received === "" ? null : parseReceivedAt(received, options.dateOrder, options.timeZone);
    return {
      // Row 1 is the heading row, so the first data row is row 2, as in a spreadsheet.
      row: index + 2,
      record_id: clip(cell(line, "recordId"), LIMITS.recordId),
      customer_name: clip(cell(line, "customerName"), LIMITS.name),
      customer_email: clip(cell(line, "customerEmail"), LIMITS.email),
      channel: parseChannel(cell(line, "channel"), options.defaultChannel).slice(0, 40),
      subject: clip(mapping.subject === null ? subjectFromMessage(message) : cell(line, "subject"), LIMITS.subject),
      message: clip(message, LIMITS.message),
      // A cell that is not a date is sent as one the database cannot read either, so it gives the same reason.
      received_at: received === "" ? null : (parsed ?? "not a date"),
    };
  });
}

const CHANNELS = new Set(["email", "live_chat", "app_review", "survey", "social", "phone_transcript"]);

/** Why the database will reject this row, in the same order and words as public.import_issues; null when it looks fine. */
export function rowProblem(row: ImportRow, now: Date): string | null {
  const received = row.received_at === null ? null : Date.parse(row.received_at);
  if (received !== null && Number.isNaN(received)) return "The received time is not a date.";
  if (row.message === "") return "The message is empty.";
  if (row.message.length > LIMITS.message) return "The message is longer than 10,000 characters.";
  if (row.customer_name === "") return "The customer name is empty.";
  if (row.customer_name.length > LIMITS.name) return "The customer name is longer than 120 characters.";
  if (row.subject === "") return "The subject is empty.";
  if (row.subject.length > LIMITS.subject) return "The subject is longer than 200 characters.";
  if (!CHANNELS.has(row.channel)) return "The channel is not one Buddy knows.";
  const email = row.customer_email.toLowerCase();
  if (email !== "" && (email.length > LIMITS.email || !EMAIL.test(email))) return "The email address is not valid.";
  if (received === null) return "The received time is missing.";
  if (received > now.getTime() + 5 * 60_000) return "The received time is in the future.";
  if (row.record_id.length > LIMITS.recordId) return "The ID is longer than 200 characters.";
  return null;
}

/** Splits rows into requests of at most 500 rows and about 700 KB each. */
export function chunkRows(rows: ImportRow[]): ImportRow[][] {
  const chunks: ImportRow[][] = [];
  let current: ImportRow[] = [];
  let bytes = 0;
  for (const row of rows) {
    const size = new TextEncoder().encode(JSON.stringify(row)).length;
    if (current.length > 0 && (current.length >= IMPORT_CHUNK_ROWS || bytes + size > IMPORT_CHUNK_BYTES)) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(row);
    bytes += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
