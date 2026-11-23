import { AUTH_HEADERS, BENIGN_HEADERS, COOKIE_HEADERS, SENSITIVE_NAME_PATTERN } from './defaults.ts';
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
    const sensitiveName = AUTH_HEADERS.includes(lower) || (SENSITIVE_NAME_PATTERN.test(lower) && !BENIGN_HEADERS.includes(lower));
    if (policy.redactAuthHeaders && sensitiveName) return { name, value: redactAuthValue(value) };
    if (custom.has(lower)) return { name, value: REDACTED };
    if (URL_HEADERS.includes(lower)) return { name, value: redactUrl(value, policy) };
    if (lower === 'refresh') {
      // URL může být v uvozovkách, ty se při redakci zachovají.
      return { name, value: value.replace(/(url\s*=\s*)(["']?)([^"'\s]+)/i, (_match, prefix: string, quote: string, url: string) => prefix + quote + redactUrl(url, policy)) };
    }
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
  const sensitive = (name: string) => names.has(name.toLowerCase()) || SENSITIVE_NAME_PATTERN.test(name);
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
  // Omezená délka schématu brání kvadratickému běhu na textu typu `a.a.a.…`.
  return text.replace(/\b[a-z][\w+.-]{0,31}:\/\/[^\s)'"<>]+/gi, (url) => redactUrl(url, policy));
}

export const BODY_UNPARSED = '[body omitted: unparsed]';
export const BODY_TRUNCATED = '[body omitted: truncated]';
export const BODY_TOO_LARGE = '[body omitted: size limit]';
export const NESTED_OMITTED = '[nested value omitted]';

// Vlastní značky rozšíření místo těla, ty se posílají beze změny.
const BODY_MARKERS = new Set(['[binary body]', '[file upload]', '[file]', BODY_UNPARSED, BODY_TRUNCATED, BODY_TOO_LARGE]);

// Klíč těla je citlivý, pokud obsahuje některou z těchto částí.
const SENSITIVE_BODY_PARTS = ['pass', 'pwd', 'secret', 'token', 'otp', 'cvv', 'card', 'auth', 'key', 'session'];

// Jak hluboko se hledá JSON nebo formulář vnořený v hodnotách.
const MAX_NESTING = 3;

type Sensitive = (key: string) => boolean;

/**
 * Redaguje citlivé klíče v JSON, form-urlencoded a multipart tělech.
 * Oříznutá nebo nerozparsovatelná těla nahradí značkou, surový text nikdy nepošle.
 */
export function redactBody(
  body: string | undefined,
  policy: CapturePolicy,
  truncated = false,
  mimeType = '',
): { text?: string; truncated: boolean } {
  if (body === undefined || !policy.includeBodies) return { truncated: false };
  if (typeof body !== 'string') return { text: BODY_UNPARSED, truncated: false };
  if (body === BODY_TRUNCATED || truncated) return { text: BODY_TRUNCATED, truncated: true };
  if (BODY_MARKERS.has(body)) return { text: body, truncated: false };
  const sensitive = sensitiveBodyKey(policy);
  const text = redactStructured(body, sensitive, typeof mimeType === 'string' ? mimeType.toLowerCase() : '', 0);
  return text === undefined ? { text: BODY_UNPARSED, truncated: false } : truncate(text, policy.maxBodyBytes);
}

function sensitiveBodyKey(policy: CapturePolicy): Sensitive {
  const keys = new Set(policy.redactBodyKeys.map((key) => key.toLowerCase()));
  return (key) => {
    const lower = key.toLowerCase();
    return keys.has(lower) || SENSITIVE_BODY_PARTS.some((part) => lower.includes(part));
  };
}

// Dvojice "klíč": hodnota ve volném textu; hodnota je řetězec, číslo, nebo objekt či pole bez dalšího zanoření.
const TEXT_PAIR = /"((?:[^"\\\n]|\\.){1,128})"(\s*:\s*)("(?:[^"\\\n]|\\.)*"|-?\d[\d.eE+-]*|\{[^{}]*\}|\[[^[\]]*\])/g;
const TEXT_AUTH = /\b(Bearer|Basic|Digest|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi;

/** Redaguje URL, autorizační hodnoty a citlivé dvojice klíč–hodnota ve volném textu, např. v argumentech konzole. */
export function redactSecretsInText(text: string, policy: CapturePolicy): string {
  if (typeof text !== 'string') return text;
  const sensitive = sensitiveBodyKey(policy);
  const pairs = (input: string): string =>
    input.replace(TEXT_PAIR, (match, key: string, separator: string, value: string) => {
      if (sensitive(key)) return `"${key}"${separator}"${REDACTED}"`;
      // Necitlivý objekt nebo pole může mít citlivé klíče uvnitř.
      return value.startsWith('{') || value.startsWith('[') ? `"${key}"${separator}${value[0]}${pairs(value.slice(1))}` : match;
    });
  return pairs(redactUrlsInText(text, policy).replace(TEXT_AUTH, (_match, scheme: string) => `${scheme} ${REDACTED}`));
}

function redactStructured(body: string, sensitive: Sensitive, mimeType: string, depth: number): string | undefined {
  const trimmed = body.trim();
  if (trimmed === '') return '';
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.stringify(redactJson(JSON.parse(trimmed), sensitive, depth));
    } catch {
      return undefined;
    }
  }
  if (trimmed.startsWith('--')) return redactMultipart(body, sensitive, depth);
  // Webový formulář (i multipart, který Chrome předá jako formData) smí mít pole bez hodnoty.
  if (isFormBody(trimmed, mimeType.includes('form'))) return redactForm(trimmed, sensitive, depth);
  return undefined;
}

/**
 * Form-urlencoded bez mezer, uvozovek a středníků, v každém poli nejvýš jedno `=`.
 * Pole bez `=` jsou povolená jen u těla s form Content-Type, jinak by prošel holý token.
 */
function isFormBody(text: string, declaredForm: boolean): boolean {
  if (/[\s";]/.test(text) || !text.includes('=')) return false;
  return text.split('&').every((part) => {
    const equals = part.split('=').length - 1;
    if (equals > 1) return false;
    if (equals === 0) return declaredForm && part.length > 0 && part.length <= 64;
    const name = part.slice(0, part.indexOf('='));
    return name.length > 0 && name.length <= 128;
  });
}

function redactForm(text: string, sensitive: Sensitive, depth: number): string {
  return text
    .split('&')
    .map((part) => {
      const index = part.indexOf('=');
      if (index <= 0) return part;
      const name = part.slice(0, index);
      if (sensitive(decodeName(name))) return `${name}=${encodeURIComponent(REDACTED)}`;
      const nested = redactNested(decodeName(part.slice(index + 1)), sensitive, depth);
      return nested === undefined ? part : `${name}=${encodeURIComponent(nested)}`;
    })
    .join('&');
}

/**
 * Vnořený JSON v hodnotě se rediguje také; vrací undefined, když hodnota JSON není.
 * JSON za limitem zanoření nebo rozbitý JSON s klíči se nahradí značkou, jinak by prošel neredigovaný.
 */
function redactNested(value: string, sensitive: Sensitive, depth: number): string | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
  if (depth >= MAX_NESTING) return NESTED_OMITTED;
  try {
    return JSON.stringify(redactJson(JSON.parse(trimmed), sensitive, depth + 1));
  } catch {
    return /"\s*:/.test(trimmed) ? NESTED_OMITTED : undefined;
  }
}

/** Multipart po polích: citlivá pole a soubory se nahradí, epilog se zahodí, jinak undefined. */
function redactMultipart(body: string, sensitive: Sensitive, depth: number): string | undefined {
  const match = /^--([^\r\n]{1,200})\r?\n/.exec(body);
  if (!match) return undefined;
  const delimiter = `--${match[1]}`;
  const pieces = body.slice(delimiter.length).split(new RegExp(`\\r?\\n${escapeRegExp(delimiter)}`));
  const output: string[] = [];
  let closed = false;
  for (const piece of pieces) {
    if (piece.startsWith('--')) {
      closed = true;
      break;
    }
    const part = /^\r?\n([\s\S]*?)\r?\n\r?\n([\s\S]*)$/.exec(piece);
    if (!part) return undefined;
    const [, head, value] = part;
    const disposition = /^content-disposition:(.*)$/im.exec(head)?.[1];
    const name = disposition ? /(?:^|;)\s*name="([^"]*)"/i.exec(disposition)?.[1] : undefined;
    if (name === undefined) return undefined;
    let redacted: string;
    if (/(?:^|;)\s*filename\*?=/i.test(disposition!)) redacted = '[file]';
    else if (sensitive(name)) redacted = REDACTED;
    else if (/^content-type:.*x-www-form-urlencoded/im.test(head) && isFormBody(value.trim(), true)) redacted = redactForm(value.trim(), sensitive, depth + 1);
    else redacted = redactNested(value, sensitive, depth) ?? value;
    output.push(`\r\n${head}\r\n\r\n${redacted}`);
  }
  if (!closed) return undefined;
  return `${delimiter}${output.join(`\r\n${delimiter}`)}\r\n${delimiter}--\r\n`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Pole typu {"name": "password", "value": "…"} skryjí i hodnotu.
const PAIR_NAME_KEYS = ['name', 'field', 'key', 'id'];

function redactJson(value: unknown, sensitive: Sensitive, depth: number): unknown {
  if (Array.isArray(value)) return value.map((item) => redactJson(item, sensitive, depth));
  if (typeof value === 'string') return redactNested(value, sensitive, depth) ?? value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const pairIsSensitive = PAIR_NAME_KEYS.some((key) => typeof record[key] === 'string' && sensitive(record[key] as string));
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record)) {
      const hide = sensitive(key) || (pairIsSensitive && key === 'value');
      // defineProperty zachová i klíč __proto__.
      Object.defineProperty(output, key, { value: hide ? REDACTED : redactJson(item, sensitive, depth), enumerable: true, writable: true, configurable: true });
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
