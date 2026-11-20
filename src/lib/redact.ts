import { AUTH_HEADERS, COOKIE_HEADERS } from './defaults.ts';
import type { CapturePolicy, Header } from './types.ts';

export const REDACTED = '[redacted]';

/** Keeps cookie names and replaces their values. */
export function redactCookieHeader(value: string): string {
  return value
    .split(';')
    .map((part) => {
      const index = part.indexOf('=');
      if (index === -1) return part;
      return part.slice(0, index + 1) + REDACTED;
    })
    .join(';');
}

/** Redacts only the name=value pair of Set-Cookie and keeps its attributes. */
export function redactSetCookieHeader(value: string): string {
  const [pair, ...attributes] = value.split(';');
  const index = pair.indexOf('=');
  const redacted = index === -1 ? pair : pair.slice(0, index + 1) + REDACTED;
  return [redacted, ...attributes].join(';');
}

export function redactHeaders(headers: Header[] | undefined, policy: CapturePolicy): Header[] {
  if (!headers) return [];
  const custom = new Set(policy.redactHeaders.map((name) => name.toLowerCase()));
  return headers.map(({ name, value }) => {
    const lower = name.toLowerCase();
    if (policy.redactCookies && lower === 'cookie') return { name, value: redactCookieHeader(value) };
    if (policy.redactCookies && lower === 'set-cookie') {
      return { name, value: value.split('\n').map(redactSetCookieHeader).join('\n') };
    }
    if (policy.redactAuthHeaders && AUTH_HEADERS.includes(lower)) return { name, value: redactAuthValue(value) };
    if (custom.has(lower)) return { name, value: REDACTED };
    return { name, value };
  });
}

/** Keeps the auth scheme so "Bearer" vs "Basic" stays visible. */
function redactAuthValue(value: string): string {
  const match = /^(Bearer|Basic|Digest|Token)\s+/i.exec(value);
  return match ? `${match[1]} ${REDACTED}` : REDACTED;
}

export function redactUrl(url: string, policy: CapturePolicy): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.username || parsed.password) {
    parsed.username = parsed.username ? REDACTED : '';
    parsed.password = parsed.password ? REDACTED : '';
  }
  const names = new Set(policy.redactQueryParams.map((name) => name.toLowerCase()));
  let changed = false;
  for (const key of [...parsed.searchParams.keys()]) {
    if (names.has(key.toLowerCase())) {
      parsed.searchParams.set(key, REDACTED);
      changed = true;
    }
  }
  if (!changed && !parsed.username && !parsed.password) return url;
  return parsed.toString();
}

/** Redacts sensitive JSON keys or form fields and truncates the result. */
export function redactBody(body: string | undefined, policy: CapturePolicy): { text?: string; truncated: boolean } {
  if (body === undefined || !policy.includeBodies) return { truncated: false };
  const keys = new Set(policy.redactBodyKeys.map((key) => key.toLowerCase()));
  let text = body;
  const trimmed = body.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      text = JSON.stringify(redactJson(JSON.parse(trimmed), keys));
    } catch {
      // Not valid JSON, keep the raw text.
    }
  } else if (/^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(trimmed)) {
    const params = new URLSearchParams(trimmed);
    for (const key of [...params.keys()]) if (keys.has(key.toLowerCase())) params.set(key, REDACTED);
    text = params.toString();
  }
  return truncate(text, policy.maxBodyBytes);
}

function redactJson(value: unknown, keys: Set<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => redactJson(item, keys));
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = keys.has(key.toLowerCase()) ? REDACTED : redactJson(item, keys);
    }
    return output;
  }
  return value;
}

export function truncate(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= maxBytes) return { text, truncated: false };
  const cut = new TextDecoder().decode(bytes.slice(0, maxBytes)).replace(/�$/, '');
  return { text: cut, truncated: true };
}

export function isCookieHeader(name: string): boolean {
  return COOKIE_HEADERS.includes(name.toLowerCase());
}
