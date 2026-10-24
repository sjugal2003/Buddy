import type { ImportRow } from "@/lib/csv-import";

// Turning Gmail messages into import rows (Phase 5 stage 26). Pure functions,
// so they can be tested without Google. The database checks every row again.

/** At most this many emails are saved per press of "Fetch new email". */
export const FETCH_BATCH = 50;
/** At most this many new message IDs are looked at per fetch. */
export const FETCH_SCAN = 500;
/** The first fetch looks back this many days. */
export const FIRST_FETCH_DAYS = 7;

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
}

export interface GmailMessage {
  id: string;
  internalDate?: string;
  snippet?: string;
  payload?: GmailPart;
}

/**
 * Gmail search for the emails to fetch: in the inbox, not sent by the inbox
 * itself, and newer than where the last fetch stopped (the first time, the
 * last 7 days). Gmail's "after:" takes whole seconds, so the boundary email
 * comes back and is left out by its time afterwards.
 */
export function fetchQuery(fetchedUntil: Date | null) {
  const since = fetchedUntil ? `after:${Math.floor(fetchedUntil.getTime() / 1000)}` : `newer_than:${FIRST_FETCH_DAYS}d`;
  return `in:inbox -from:me ${since}`;
}

/**
 * Which messages to read now. Gmail lists the newest first; Buddy takes the
 * oldest ones so that pressing again continues where this fetch stopped.
 */
export function planFetch(idsNewestFirst: string[], scanTruncated: boolean) {
  const oldestFirst = [...idsNewestFirst].reverse();
  const batch = oldestFirst.slice(0, FETCH_BATCH);
  return { batch, waiting: oldestFirst.length - batch.length, skippedOlder: scanTruncated };
}

function header(part: GmailPart | undefined, name: string) {
  const wanted = name.toLowerCase();
  return part?.headers?.find((h) => h.name.toLowerCase() === wanted)?.value ?? "";
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** "Asha Rao <Asha@Example.com>" → name and lower-case address. */
export function parseFrom(value: string): { name: string; email: string } {
  const trimmed = value.trim();
  const angled = trimmed.match(/^(.*)<([^<>]+)>\s*$/);
  let name = angled ? angled[1] : "";
  let email = (angled ? angled[2] : trimmed).trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) {
    if (!angled) name = trimmed;
    email = "";
  }
  name = name.trim().replace(/^"(.*)"$/, "$1").replace(/\\"/g, '"').trim();
  return { name, email };
}

function decodeBody(data: string | undefined) {
  if (!data) return "";
  try {
    return Buffer.from(data, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** Readable text from an HTML email: no tags, scripts or styles, with line breaks kept. */
export function htmlToText(html: string) {
  const text = html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]*>/g, "");
  return decodeEntities(text);
}

function findPart(part: GmailPart | undefined, mimeType: string): GmailPart | null {
  if (!part) return null;
  if (part.mimeType === mimeType && !part.filename && part.body?.data) return part;
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType);
    if (found) return found;
  }
  return null;
}

function tidy(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cut(text: string, max: number) {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** The message's text: the plain-text version if there is one, otherwise the HTML one as text. */
export function messageText(message: GmailMessage) {
  const plain = findPart(message.payload, "text/plain");
  if (plain) return tidy(decodeBody(plain.body?.data));
  const html = findPart(message.payload, "text/html");
  if (html) return tidy(htmlToText(decodeBody(html.body?.data)));
  return "";
}

/** When Gmail received the message, or null if it did not say. */
export function receivedAt(message: GmailMessage): Date | null {
  const ms = Number(message.internalDate);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms) : null;
}

/** One email as an import row; the Gmail message ID makes sure it is saved only once. */
export function messageToRow(message: GmailMessage, row: number): ImportRow {
  const from = parseFrom(header(message.payload, "From"));
  const name = from.name || from.email.split("@")[0] || "Unknown sender";
  const subject = header(message.payload, "Subject").replace(/\s+/g, " ").trim();
  const text = messageText(message) || tidy(decodeEntities(message.snippet ?? "")) || "(no message text)";
  return {
    row,
    record_id: message.id,
    customer_name: cut(name, 120),
    customer_email: from.email,
    channel: "email",
    subject: cut(subject || "(no subject)", 200),
    message: cut(text, 10_000),
    received_at: receivedAt(message)?.toISOString() ?? null,
  };
}
