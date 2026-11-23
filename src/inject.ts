// Runs in the page's MAIN world at document_start and reports console, errors and fetch/XHR.
import { BODY_TRUNCATED } from './lib/redact.ts';
import { serializeArg } from './lib/serialize.ts';
import type { ConsoleLevel, PageEntry } from './lib/types.ts';

const ENTRY_EVENT = 'screenshot-note:entry';
const CONFIG_EVENT = 'screenshot-note:config';
const MAX_BODY = 256 * 1024;
const TEXT_TYPES = /(^text\/|json|xml|javascript|x-www-form-urlencoded|graphql)/i;
// Streamy nemají konec, jejich tělo se nečte.
const STREAM_TYPES = /(event-stream|ndjson|jsonl|json-seq|multipart\/x-mixed-replace)/i;
const BODY_READ_TIMEOUT_MS = 30_000;

declare global {
  interface Window {
    __screenshotNoteRecorder?: boolean;
  }
}

if (!window.__screenshotNoteRecorder) {
  window.__screenshotNoteRecorder = true;
  install();
}

function install(): void {
  let recordBodies = false;
  let enabled = true;

  document.addEventListener(CONFIG_EVENT, (event) => {
    try {
      const config = JSON.parse(String((event as CustomEvent).detail));
      recordBodies = Boolean(config.recordBodies);
      enabled = config.enabled !== false;
    } catch {
      // Ignore malformed config.
    }
  });

  // Detail is a JSON string because objects do not cross worlds reliably.
  const emit = (entry: PageEntry) => {
    if (!enabled) return;
    try {
      document.dispatchEvent(new CustomEvent(ENTRY_EVENT, { detail: JSON.stringify(entry) }));
    } catch {
      // Never break the page.
    }
  };

  const levels: ConsoleLevel[] = ['log', 'info', 'warn', 'error', 'debug', 'trace'];
  for (const level of levels) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      // Vypnuté nahrávání nesmí stránku zdržovat serializací.
      if (enabled) emit({
        kind: 'console',
        time: Date.now(),
        level,
        args: args.map(serializeArg),
        stack: level === 'error' || level === 'trace' ? cleanStack(new Error().stack) : undefined,
        url: location.href,
      });
      original(...args);
    };
  }

  window.addEventListener('error', (event) => {
    if (!(event instanceof ErrorEvent)) return;
    emit({
      kind: 'error',
      time: Date.now(),
      message: event.message,
      source: event.filename,
      line: event.lineno,
      column: event.colno,
      stack: event.error instanceof Error ? event.error.stack : undefined,
      unhandledRejection: false,
      url: location.href,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    emit({
      kind: 'error',
      time: Date.now(),
      message: reason instanceof Error ? `${reason.name}: ${reason.message}` : serializeArg(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
      unhandledRejection: true,
      url: location.href,
    });
  });

  const wantsBody = (type: string) => enabled && recordBodies && TEXT_TYPES.test(type) && !STREAM_TYPES.test(type);

  const originalFetch = window.fetch;
  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
    const start = Date.now();
    const request = input instanceof Request ? input : undefined;
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
    const url = absoluteUrl(request ? request.url : String(input));
    const requestBody = enabled && recordBodies ? bodyText(init?.body) : undefined;
    try {
      const response = await originalFetch.call(this, input, init);
      const base = { kind: 'request' as const, time: start, api: 'fetch' as const, method, url, status: response.status, durationMs: Date.now() - start, requestBody };
      const type = response.headers.get('content-type') ?? '';
      if (wantsBody(type)) {
        readCapped(response.clone())
          .then((body) => emit({ ...base, responseType: type, ...body }))
          .catch(() => emit({ ...base, responseType: type }));
      } else {
        emit({ ...base, responseType: type });
      }
      return response;
    } catch (error) {
      emit({ kind: 'request', time: start, api: 'fetch', method, url, durationMs: Date.now() - start, requestBody, error: String(error) });
      throw error;
    }
  };

  const open = XMLHttpRequest.prototype.open;
  const send = XMLHttpRequest.prototype.send;
  const meta = new WeakMap<XMLHttpRequest, { method: string; url: string }>();

  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    meta.set(this, { method: method.toUpperCase(), url: absoluteUrl(String(url)) });
    return (open as (...args: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof XMLHttpRequest.prototype.open;

  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const info = meta.get(this);
    const start = Date.now();
    const requestBody = enabled && recordBodies ? bodyText(body ?? undefined) : undefined;
    // Jeden listener na jedno send(), znovu použitý XHR jinak hlásí staré requesty.
    this.addEventListener('loadend', () => {
      if (!info) return;
      const type = this.getResponseHeader('content-type') ?? '';
      let responseBody: { responseBody?: string; truncated?: boolean } = {};
      if (wantsBody(type) && (this.responseType === '' || this.responseType === 'text')) {
        responseBody = limit(this.responseText);
      }
      emit({
        kind: 'request',
        time: start,
        api: 'xhr',
        method: info.method,
        url: info.url,
        status: this.status || undefined,
        durationMs: Date.now() - start,
        requestBody,
        responseType: type,
        error: this.status === 0 ? 'network error or aborted' : undefined,
        ...responseBody,
      });
    }, { once: true });
    return send.call(this, body);
  };
}

function absoluteUrl(url: string): string {
  try {
    return new URL(url, location.href).href;
  } catch {
    return url;
  }
}

function bodyText(body: unknown): string | undefined {
  if (typeof body === 'string') return capped(body);
  if (body instanceof URLSearchParams) return capped(body.toString());
  if (body instanceof FormData) {
    const fields: string[] = [];
    body.forEach((value, key) => fields.push(`${encodeURIComponent(key)}=${typeof value === 'string' ? encodeURIComponent(value) : '[file]'}`));
    return capped(fields.join('&'));
  }
  if (body === undefined || body === null) return undefined;
  return '[binary body]';
}

// Oříznuté tělo nejde spolehlivě redigovat, posílá se jen značka.
function capped(text: string): string {
  return text.length > MAX_BODY ? BODY_TRUNCATED : text;
}

/** Čte tělo nejvýš do MAX_BODY znaků a pak čtení zruší, celé tělo se do paměti nenačte. */
async function readCapped(response: Response): Promise<{ responseBody: string; truncated?: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) return { responseBody: '' };
  const decoder = new TextDecoder();
  // Zrušení čtení uvolní i čekající read() u pomalé odpovědi.
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => undefined);
  }, BODY_READ_TIMEOUT_MS);
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (text.length > MAX_BODY) {
        void reader.cancel().catch(() => undefined);
        return { responseBody: text.slice(0, MAX_BODY), truncated: true };
      }
    }
  } finally {
    clearTimeout(timer);
  }
  if (timedOut) return { responseBody: text.slice(0, MAX_BODY), truncated: true };
  return limit(text + decoder.decode());
}

function limit(text: string): { responseBody: string; truncated?: boolean } {
  return text.length > MAX_BODY ? { responseBody: text.slice(0, MAX_BODY), truncated: true } : { responseBody: text };
}

function cleanStack(stack: string | undefined): string | undefined {
  return stack?.split('\n').slice(2).join('\n');
}
