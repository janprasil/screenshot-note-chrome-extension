// Validation of page entries; the page itself can send events, so they are untrusted.
import { BODY_TRUNCATED } from './redact.ts';
import type { ConsoleLevel, PageEntry } from './types.ts';

export const MAX_ARGS = 50;
// serializeArg cuts at 4000 characters and adds a length marker, hence the margin.
export const MAX_ARG_LENGTH = 4_100;
export const MAX_TEXT_LENGTH = 16_000;
export const MAX_URL_LENGTH = 8_000;
export const MAX_BODY_LENGTH = 256 * 1024;
/** Upper bound for the whole entry buffer in the content script (UTF-16 units of JSON). */
export const MAX_BUFFER_CHARS = 8 * 1024 * 1024;

const LEVELS: ConsoleLevel[] = ['log', 'info', 'warn', 'error', 'debug', 'trace'];

const text = (value: unknown, max: number): string | undefined => (typeof value === 'string' ? value.slice(0, max) : undefined);
const number = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const nonNegative = (value: unknown): number | undefined => {
  const parsed = number(value);
  return parsed === undefined ? undefined : Math.max(0, parsed);
};
const httpStatus = (value: unknown): number | undefined => (Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 999 ? (value as number) : undefined);

/** Returns the sanitized entry, or undefined when its shape is invalid. */
export function sanitizePageEntry(raw: unknown, now = Date.now()): PageEntry | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const entry = raw as Record<string, unknown>;
  const rawTime = number(entry.time);
  if (rawTime === undefined || rawTime < 0) return undefined;
  const time = Math.min(rawTime, now);
  const url = text(entry.url, MAX_URL_LENGTH) ?? '';

  if (entry.kind === 'console') {
    if (!LEVELS.includes(entry.level as ConsoleLevel)) return undefined;
    const args = Array.isArray(entry.args) ? entry.args.slice(0, MAX_ARGS).map((arg) => (typeof arg === 'string' ? arg.slice(0, MAX_ARG_LENGTH) : String(arg).slice(0, MAX_ARG_LENGTH))) : [];
    return { kind: 'console', time, level: entry.level as ConsoleLevel, args, stack: text(entry.stack, MAX_TEXT_LENGTH), url };
  }
  if (entry.kind === 'error') {
    return {
      kind: 'error',
      time,
      message: text(entry.message, MAX_TEXT_LENGTH) ?? '',
      source: text(entry.source, MAX_URL_LENGTH),
      line: nonNegative(entry.line),
      column: nonNegative(entry.column),
      stack: text(entry.stack, MAX_TEXT_LENGTH),
      unhandledRejection: entry.unhandledRejection === true,
      url,
    };
  }
  if (entry.kind === 'request') {
    if (typeof entry.method !== 'string' || entry.method.length > 32 || typeof entry.url !== 'string') return undefined;
    if (entry.api !== 'fetch' && entry.api !== 'xhr') return undefined;
    const responseBody = typeof entry.responseBody === 'string' ? entry.responseBody : undefined;
    const requestBody = typeof entry.requestBody === 'string' ? entry.requestBody : undefined;
    const tooLong = (responseBody?.length ?? 0) > MAX_BODY_LENGTH;
    return {
      kind: 'request',
      time,
      api: entry.api,
      method: entry.method,
      url,
      status: httpStatus(entry.status),
      durationMs: nonNegative(entry.durationMs),
      requestBody: requestBody !== undefined && requestBody.length > MAX_BODY_LENGTH ? BODY_TRUNCATED : requestBody,
      responseBody: tooLong ? responseBody!.slice(0, MAX_BODY_LENGTH) : responseBody,
      responseType: text(entry.responseType, 200),
      error: text(entry.error, MAX_TEXT_LENGTH),
      truncated: entry.truncated === true || tooLong || undefined,
    };
  }
  return undefined;
}

/** Approximate entry size in UTF-16 units of JSON. */
export function entrySize(entry: PageEntry): number {
  return JSON.stringify(entry).length;
}
