import { AUTH_HEADERS, COOKIE_HEADERS } from './defaults.ts';
import type { CapturePolicy, Header } from './types.ts';

export const REDACTED = '[redacted]';

// Hlavičky, jejichž hodnota je URL.
const URL_HEADERS = ['location', 'referer', 'origin', 'content-location'];

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
    if (URL_HEADERS.includes(lower)) return { name, value: redactUrl(value, policy) };
    if (lower === 'refresh') return { name, value: value.replace(/(url\s*=\s*)(\S+)/i, (_match, prefix: string, url: string) => prefix + redactUrl(url, policy)) };
    return { name, value };
  });
}

/** Keeps the auth scheme so "Bearer" vs "Basic" stays visible. */
function redactAuthValue(value: string): string {
  const match = /^(Bearer|Basic|Digest|Token)\s+/i.exec(value);
  return match ? `${match[1]} ${REDACTED}` : REDACTED;
}

/** Redaguje přihlašovací údaje a citlivé parametry v query i ve fragmentu, funguje i pro relativní URL. */
export function redactUrl(url: string, policy: CapturePolicy): string {
  if (typeof url !== 'string') return '';
  const names = new Set(policy.redactQueryParams.map((name) => name.toLowerCase()));
  const sensitive = (name: string) => names.has(name.toLowerCase());
  let base = url;
  let query: string | undefined;
  let fragment: string | undefined;
  const hashIndex = base.indexOf('#');
  if (hashIndex !== -1) {
    fragment = base.slice(hashIndex + 1);
    base = base.slice(0, hashIndex);
  }
  const queryIndex = base.indexOf('?');
  if (queryIndex !== -1) {
    query = base.slice(queryIndex + 1);
    base = base.slice(0, queryIndex);
  }
  let output = redactUserInfo(base);
  if (query !== undefined) output += `?${redactParams(query, sensitive)}`;
  if (fragment !== undefined) output += `#${redactFragment(fragment, sensitive)}`;
  return output;
}

function redactUserInfo(base: string): string {
  if (!base.includes('@')) return base;
  // Protokolově relativní URL (`//u:p@host`) parsujeme s dočasným schématem.
  const relative = base.startsWith('//');
  try {
    const parsed = new URL(relative ? `http:${base}` : base);
    if (!parsed.username && !parsed.password) return base;
    parsed.username = parsed.username ? REDACTED : '';
    parsed.password = parsed.password ? REDACTED : '';
    return relative ? parsed.href.slice('http:'.length) : parsed.href;
  } catch {
    return base;
  }
}

/** Nahradí hodnoty citlivých parametrů a ostatní nechá beze změny. */
function redactParams(params: string, sensitive: (name: string) => boolean): string {
  return params
    .split(/([&#])/)
    .map((part, position) => {
      if (position % 2 === 1) return part;
      const index = part.indexOf('=');
      if (index <= 0) return part;
      return sensitive(decodeName(part.slice(0, index))) ? `${part.slice(0, index + 1)}${encodeURIComponent(REDACTED)}` : part;
    })
    .join('');
}

// Fragment bývá `a=1&b=2` (implicit flow) nebo `/route?a=1` (SPA).
function redactFragment(fragment: string, sensitive: (name: string) => boolean): string {
  const index = fragment.indexOf('?');
  if (index !== -1) return `${fragment.slice(0, index + 1)}${redactParams(fragment.slice(index + 1), sensitive)}`;
  return fragment.includes('=') ? redactParams(fragment, sensitive) : fragment;
}

function decodeName(name: string): string {
  try {
    return decodeURIComponent(name.replace(/\+/g, ' ')).replace(/[\t\n\r]/g, '');
  } catch {
    return name.replace(/[\t\n\r]/g, '');
  }
}

/** Redaguje všechny absolutní URL nalezené ve volném textu, např. ve stack trace. */
export function redactUrlsInText(text: string, policy: CapturePolicy): string {
  if (typeof text !== 'string') return text;
  return text.replace(/\b[a-z][\w+.-]*:\/\/[^\s)'"<>]+/gi, (url) => redactUrl(url, policy));
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
