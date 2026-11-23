// Runs in the page's MAIN world at document_start and reports console, errors and fetch/XHR.
// The background registers it only while recording is on.
import { CHANNEL_ACK, CHANNEL_HELLO, CHANNEL_READY, isChannelMessage, type ChannelConfig } from './lib/page-channel.ts';
import { BODY_TRUNCATED } from './lib/redact.ts';
import { serializeArg } from './lib/serialize.ts';
import type { ConsoleLevel, PageEntry } from './lib/types.ts';

const MAX_QUEUE = 200;
const MAX_BODY = 256 * 1024;
const TEXT_TYPES = /(^text\/|json|xml|javascript|x-www-form-urlencoded|graphql)/i;
// Streams never end, so their body is not read.
const STREAM_TYPES = /(event-stream|ndjson|jsonl|json-seq|multipart\/x-mixed-replace)/i;
const BODY_READ_TIMEOUT_MS = 30_000;

install();

function install(): void {
  let recordBodies = false;
  let enabled = true;
  let port: MessagePort | undefined;
  // Entries wait in a queue until the channel is up.
  const queue: string[] = [];

  // The port is accepted only once; the first handshake comes from the content script.
  const onHello = (event: MessageEvent) => {
    if (port || !isChannelMessage(event, CHANNEL_HELLO) || !event.ports[0]) return;
    window.removeEventListener('message', onHello);
    port = event.ports[0];
    port.onmessage = (message: MessageEvent<ChannelConfig>) => {
      if (message.data?.type !== 'config') return;
      recordBodies = Boolean(message.data.recordBodies);
      enabled = message.data.enabled !== false;
      if (!enabled) queue.length = 0;
    };
    port.postMessage({ type: CHANNEL_ACK });
    for (const item of queue.splice(0)) port.postMessage(item);
  };
  window.addEventListener('message', onHello);
  // The content script may have run earlier and missed the first hello.
  window.postMessage({ type: CHANNEL_READY }, '*');

  // Entries go as JSON text so the content script can measure them before parsing.
  const emit = (entry: PageEntry) => {
    if (!enabled) return;
    try {
      const text = JSON.stringify(entry);
      if (port) port.postMessage(text);
      else if (queue.length < MAX_QUEUE) queue.push(text);
    } catch {
      // Never break the page.
    }
  };

  const levels: ConsoleLevel[] = ['log', 'info', 'warn', 'error', 'debug', 'trace'];
  for (const level of levels) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      // With recording off, the page must not pay for serialization.
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
    // One listener per send(), otherwise a reused XHR reports old requests.
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

// A truncated body cannot be redacted reliably, so only a marker is sent.
function capped(text: string): string {
  return text.length > MAX_BODY ? BODY_TRUNCATED : text;
}

/** Reads the body up to MAX_BODY characters and then cancels, so the full body is never loaded. */
async function readCapped(response: Response): Promise<{ responseBody: string; truncated?: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) return { responseBody: '' };
  const decoder = new TextDecoder();
  // Cancelling also releases a pending read() of a slow response.
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
