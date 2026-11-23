import { isCookieHeader, redactBody, redactHeaders, redactUrl, redactUrlsInText } from './redact.ts';
import type { CapturePolicy, Header, NetworkEntry, PageRequestEntry } from './types.ts';

const MATCH_WINDOW_MS = 3_000;

interface HarInput {
  network: NetworkEntry[];
  pageRequests: PageRequestEntry[];
  pageUrl: string;
  pageTitle: string;
  extensionVersion: string;
  policy: CapturePolicy;
}

/** Builds HAR 1.2 from webRequest data and page-level fetch/XHR records. */
export function buildHar(input: HarInput): unknown {
  const { policy } = input;
  const pageId = 'page_1';
  const used = new Set<PageRequestEntry>();
  const sorted = input.network.slice().sort((a, b) => a.startTime - b.startTime);

  // Vadný záznam se přeskočí, nesmí shodit celý HAR.
  const entries: { startedDateTime: string }[] = [];
  for (const entry of sorted) {
    const page = matchPageRequest(entry, input.pageRequests, used);
    try {
      entries.push(toHarEntry(entry, page, pageId, policy));
    } catch {
      // Vadný záznam stránky nesmí shodit záznam webRequest.
      if (page) used.delete(page);
      try {
        entries.push(toHarEntry(entry, undefined, pageId, policy));
      } catch {
        // Přeskočit.
      }
    }
  }
  for (const page of input.pageRequests) {
    if (used.has(page)) continue;
    try {
      entries.push(pageOnlyEntry(page, pageId, policy));
    } catch {
      // Přeskočit.
    }
  }
  entries.sort((a, b) => a.startedDateTime.localeCompare(b.startedDateTime));

  const firstStart = sorted[0]?.startTime ?? Date.now();
  return {
    log: {
      version: '1.2',
      creator: { name: 'Screenshot Note', version: input.extensionVersion },
      pages: [
        {
          startedDateTime: new Date(firstStart).toISOString(),
          id: pageId,
          title: redactUrl(input.pageUrl, policy),
          pageTimings: {},
          _title: input.pageTitle,
        },
      ],
      entries,
    },
  };
}

/** Párování webRequest záznamů se záznamy stránky stejně jako v HARu. */
export function pairPageRequests(network: NetworkEntry[], pages: PageRequestEntry[]): Map<NetworkEntry, PageRequestEntry> {
  const used = new Set<PageRequestEntry>();
  const pairs = new Map<NetworkEntry, PageRequestEntry>();
  for (const entry of network.slice().sort((a, b) => a.startTime - b.startTime)) {
    const page = matchPageRequest(entry, pages, used);
    if (page) pairs.set(entry, page);
  }
  return pairs;
}

function matchPageRequest(entry: NetworkEntry, pages: PageRequestEntry[], used: Set<PageRequestEntry>) {
  if (entry.type !== 'xmlhttprequest' && entry.type !== 'fetch' && entry.type !== 'other') return undefined;
  let best: PageRequestEntry | undefined;
  let bestDelta = Infinity;
  for (const page of pages) {
    if (used.has(page) || typeof page.method !== 'string' || typeof page.url !== 'string' || !Number.isFinite(page.time)) continue;
    if (page.method.toUpperCase() !== entry.method.toUpperCase()) continue;
    if (!sameUrl(page.url, entry.url)) continue;
    const delta = Math.abs(page.time - entry.startTime);
    if (delta < MATCH_WINDOW_MS && delta < bestDelta) {
      best = page;
      bestDelta = delta;
    }
  }
  if (best) used.add(best);
  return best;
}

function sameUrl(a: string, b: string): boolean {
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return a === b;
  }
}

function toHarEntry(entry: NetworkEntry, page: PageRequestEntry | undefined, pageId: string, policy: CapturePolicy) {
  const url = redactUrl(entry.url, policy);
  const requestHeaders = redactHeaders(entry.requestHeaders, policy);
  const responseHeaders = redactHeaders(entry.responseHeaders, policy);
  const time = entry.endTime ? Math.max(0, entry.endTime - entry.startTime) : -1;
  const mimeType = headerValue(entry.responseHeaders, 'content-type') ?? page?.responseType ?? '';
  const requestBody = redactBody(page?.requestBody ?? entry.requestBody, policy, false, headerValue(entry.requestHeaders, 'content-type'));
  const responseBody = redactBody(page?.responseBody, policy, page?.truncated, mimeType);
  const status = entry.statusCode ?? page?.status ?? 0;

  return {
    pageref: pageId,
    startedDateTime: new Date(entry.startTime).toISOString(),
    time,
    request: {
      method: entry.method,
      url,
      httpVersion: httpVersion(entry.statusLine),
      cookies: cookiesFrom(requestHeaders, 'cookie'),
      headers: requestHeaders,
      queryString: queryString(url),
      headersSize: -1,
      bodySize: requestBody.text ? requestBody.text.length : 0,
      ...(requestBody.text !== undefined
        ? { postData: { mimeType: headerValue(entry.requestHeaders, 'content-type') ?? '', text: requestBody.text } }
        : {}),
    },
    response: {
      status,
      statusText: statusText(entry.statusLine),
      httpVersion: httpVersion(entry.statusLine),
      cookies: cookiesFrom(responseHeaders, 'set-cookie'),
      headers: responseHeaders,
      content: {
        size: responseBody.text ? responseBody.text.length : 0,
        mimeType,
        ...(responseBody.text !== undefined ? { text: responseBody.text } : {}),
      },
      // Hlavičky už prošly redakcí včetně Location.
      redirectURL: headerValue(responseHeaders, 'location') ?? '',
      headersSize: -1,
      bodySize: -1,
      ...(entry.error ? { _error: redactUrlsInText(entry.error, policy) } : {}),
    },
    cache: {},
    timings: { send: 0, wait: Math.max(0, time), receive: 0 },
    serverIPAddress: entry.ip,
    _resourceType: entry.type,
    _initiator: entry.initiator,
    _fromCache: entry.fromCache ?? false,
    _truncated: requestBody.truncated || responseBody.truncated || page?.truncated || undefined,
  };
}

/** Requests seen only by the page wrapper, e.g. ones served by a service worker. */
function pageOnlyEntry(page: PageRequestEntry, pageId: string, policy: CapturePolicy) {
  const url = redactUrl(page.url, policy);
  const requestBody = redactBody(page.requestBody, policy);
  const responseBody = redactBody(page.responseBody, policy, page.truncated, page.responseType);
  return {
    pageref: pageId,
    startedDateTime: new Date(page.time).toISOString(),
    time: page.durationMs ?? -1,
    request: {
      method: page.method,
      url,
      httpVersion: '',
      cookies: [],
      headers: [],
      queryString: queryString(url),
      headersSize: -1,
      bodySize: requestBody.text ? requestBody.text.length : 0,
      ...(requestBody.text !== undefined ? { postData: { mimeType: '', text: requestBody.text } } : {}),
    },
    response: {
      status: page.status ?? 0,
      statusText: '',
      httpVersion: '',
      cookies: [],
      headers: [],
      content: {
        size: responseBody.text ? responseBody.text.length : 0,
        mimeType: page.responseType ?? '',
        ...(responseBody.text !== undefined ? { text: responseBody.text } : {}),
      },
      redirectURL: '',
      headersSize: -1,
      bodySize: -1,
      ...(page.error ? { _error: redactUrlsInText(page.error, policy) } : {}),
    },
    cache: {},
    timings: { send: 0, wait: Math.max(0, page.durationMs ?? 0), receive: 0 },
    _resourceType: page.api,
    _source: 'page',
  };
}

function headerValue(headers: Header[] | undefined, name: string): string | undefined {
  return headers?.find((header) => header.name.toLowerCase() === name)?.value;
}

function cookiesFrom(headers: Header[], name: 'cookie' | 'set-cookie') {
  const cookies: { name: string; value: string }[] = [];
  for (const header of headers) {
    if (!isCookieHeader(header.name) || header.name.toLowerCase() !== name) continue;
    const parts = name === 'cookie' ? header.value.split(';') : header.value.split('\n').map((line) => line.split(';')[0]);
    for (const part of parts) {
      const index = part.indexOf('=');
      if (index > 0) cookies.push({ name: part.slice(0, index).trim(), value: part.slice(index + 1).trim() });
    }
  }
  return cookies;
}

function queryString(url: string) {
  try {
    return [...new URL(url).searchParams].map(([name, value]) => ({ name, value }));
  } catch {
    return [];
  }
}

function httpVersion(statusLine: string | undefined): string {
  return statusLine?.split(' ')[0] ?? '';
}

function statusText(statusLine: string | undefined): string {
  return statusLine?.split(' ').slice(2).join(' ') ?? '';
}
