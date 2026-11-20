// Service worker: records webRequest traffic per tab and serves capture requests from the Mac app.
import { buildBundle } from './lib/capture.ts';
import { DEFAULT_SETTINGS, NATIVE_HOST, PROTOCOL_VERSION, normalizePolicy } from './lib/defaults.ts';
import { RingBuffer } from './lib/ring-buffer.ts';
import type { CaptureBundle, CapturePolicy, Header, NetworkEntry, RecorderSettings, Rect } from './lib/types.ts';
import type { CollectRequest, CollectResponse } from './content.ts';

type Stored = NetworkEntry & { time: number };

const MAX_PER_TAB = 500;
const MAX_REQUEST_BODY = 64 * 1024;
const MAX_BUNDLE_BYTES = 32 * 1024 * 1024;
const extensionVersion = chrome.runtime.getManifest().version;

let settings: RecorderSettings = DEFAULT_SETTINGS;
const tabs = new Map<number, { buffer: RingBuffer<Stored>; byId: Map<string, Stored> }>();
const dirty = new Set<number>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;

// ---------- settings and persistence ----------

const ready = (async () => {
  const { settings: stored } = await chrome.storage.local.get('settings');
  settings = { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
  const saved = await chrome.storage.session.get(null);
  for (const [key, value] of Object.entries(saved)) {
    if (!key.startsWith('net:')) continue;
    const state = tabState(Number(key.slice(4)));
    state.buffer.replace(value as Stored[]);
    for (const entry of state.buffer.toArray()) state.byId.set(entry.requestId, entry);
  }
})();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  settings = { ...DEFAULT_SETTINGS, ...(changes.settings.newValue ?? {}) };
  for (const state of tabs.values()) state.buffer.setMaxAge(settings.bufferMs);
  if (!settings.enabled) {
    tabs.clear();
    void chrome.storage.session.clear();
  }
});

function tabState(tabId: number) {
  let state = tabs.get(tabId);
  if (!state) {
    state = { buffer: new RingBuffer<Stored>(MAX_PER_TAB, settings.bufferMs), byId: new Map() };
    tabs.set(tabId, state);
  }
  return state;
}

function markDirty(tabId: number): void {
  dirty.add(tabId);
  flushTimer ??= setTimeout(flush, 1_000);
}

// Session storage is memory-only, it survives service worker restarts but not browser restarts.
async function flush(): Promise<void> {
  flushTimer = undefined;
  const items: Record<string, Stored[]> = {};
  for (const tabId of dirty) {
    const state = tabs.get(tabId);
    if (!state) continue;
    state.buffer.prune();
    items[`net:${tabId}`] = state.buffer.toArray();
    state.byId = new Map(items[`net:${tabId}`].map((entry) => [entry.requestId, entry]));
  }
  dirty.clear();
  try {
    await chrome.storage.session.set(items);
  } catch {
    // Quota exceeded, the in-memory buffer still works.
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  tabs.delete(tabId);
  void chrome.storage.session.remove(`net:${tabId}`);
});

// ---------- webRequest recording ----------

const filter: chrome.webRequest.RequestFilter = { urls: ['<all_urls>'] };

function entryFor(details: { tabId: number; requestId: string }): Stored | undefined {
  if (!settings.enabled || details.tabId < 0) return undefined;
  return tabs.get(details.tabId)?.byId.get(details.requestId);
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!settings.enabled || details.tabId < 0) return;
    const state = tabState(details.tabId);
    const entry: Stored = {
      requestId: details.requestId,
      tabId: details.tabId,
      url: details.url,
      method: details.method,
      type: details.type,
      initiator: details.initiator,
      startTime: details.timeStamp,
      time: details.timeStamp,
      requestBody: requestBodyText(details.requestBody),
    };
    state.buffer.push(entry);
    state.byId.set(entry.requestId, entry);
    markDirty(details.tabId);
  },
  filter,
  ['requestBody'],
);

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const entry = entryFor(details);
    if (!entry) return;
    entry.requestHeaders = headers(details.requestHeaders);
    markDirty(details.tabId);
  },
  filter,
  ['requestHeaders', 'extraHeaders'],
);

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    const entry = entryFor(details);
    if (!entry) return;
    entry.statusCode = details.statusCode;
    entry.statusLine = details.statusLine;
    entry.responseHeaders = headers(details.responseHeaders);
    markDirty(details.tabId);
  },
  filter,
  ['responseHeaders', 'extraHeaders'],
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    const entry = entryFor(details);
    if (!entry) return;
    entry.endTime = details.timeStamp;
    entry.statusCode = details.statusCode;
    entry.statusLine = details.statusLine;
    entry.fromCache = details.fromCache;
    entry.ip = details.ip;
    markDirty(details.tabId);
  },
  filter,
);

chrome.webRequest.onErrorOccurred.addListener((details) => {
  const entry = entryFor(details);
  if (!entry) return;
  entry.endTime = details.timeStamp;
  entry.error = details.error;
  markDirty(details.tabId);
}, filter);

function headers(list: chrome.webRequest.HttpHeader[] | undefined): Header[] | undefined {
  return list?.map((header) => ({ name: header.name, value: header.value ?? '[binary]' }));
}

function requestBodyText(body: chrome.webRequest.WebRequestBody | null | undefined): string | undefined {
  if (!body) return undefined;
  if (body.formData) {
    return Object.entries(body.formData)
      .flatMap(([key, values]) => values.map((value) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`))
      .join('&');
  }
  const bytes = body.raw?.find((part) => part.bytes)?.bytes;
  if (!bytes) return body.raw?.length ? '[file upload]' : undefined;
  const slice = bytes.byteLength > MAX_REQUEST_BODY ? bytes.slice(0, MAX_REQUEST_BODY) : bytes;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(slice);
  } catch {
    return '[binary body]';
  }
}

// ---------- capture ----------

export interface CaptureTarget {
  windowBounds?: Rect;
  windowTitle?: string;
  tabId?: number;
}

async function findTab(target: CaptureTarget | undefined): Promise<chrome.tabs.Tab | undefined> {
  if (target?.tabId !== undefined) return chrome.tabs.get(target.tabId).catch(() => undefined);
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal', 'popup', 'app'] });
  const activeTab = (window: chrome.windows.Window) => window.tabs?.find((tab) => tab.active);

  if (target?.windowBounds) {
    const bounds = target.windowBounds;
    const match = windows.find(
      (window) =>
        Math.abs((window.left ?? 0) - bounds.x) <= 8 &&
        Math.abs((window.top ?? 0) - bounds.y) <= 8 &&
        Math.abs((window.width ?? 0) - bounds.width) <= 8 &&
        Math.abs((window.height ?? 0) - bounds.height) <= 8,
    );
    if (match) return activeTab(match);
  }
  if (target?.windowTitle) {
    const title = target.windowTitle;
    const match = windows.find((window) => {
      const tab = activeTab(window);
      return tab?.title && (title === tab.title || title.startsWith(tab.title));
    });
    if (match) return activeTab(match);
  }
  const focused = windows.find((window) => window.focused) ?? windows[0];
  return focused ? activeTab(focused) : undefined;
}

async function capture(policyInput: Partial<CapturePolicy> | undefined, target?: CaptureTarget): Promise<CaptureBundle> {
  await ready;
  if (!settings.enabled) throw new CaptureError('disabled', 'Recording is turned off in the extension.');
  const policy = normalizePolicy(policyInput);
  const tab = await findTab(target);
  if (tab?.id === undefined) throw new CaptureError('no-tab', 'No browser tab found.');

  const since = Date.now() - policy.windowMs;
  const request: CollectRequest = {
    type: 'collect',
    since,
    includeElements: policy.includeElements,
    includeElementText: policy.includeElementText,
  };
  const collected = (await chrome.tabs.sendMessage(tab.id, request, { frameId: 0 }).catch(() => undefined)) as CollectResponse | undefined;

  const state = tabs.get(tab.id);
  state?.buffer.prune();
  const network = (state?.buffer.since(since) ?? []).map(({ time: _time, ...entry }) => entry);
  const input = {
    page: collected?.page ?? {
      url: tab.url ?? '',
      title: tab.title ?? '',
      userAgent: navigator.userAgent,
      language: navigator.language,
      geometry: fallbackGeometry(tab),
    },
    entries: collected?.entries ?? [],
    elements: collected?.elements,
    network,
    policy,
    extensionVersion,
  };

  let bundle = buildBundle(input);
  if (JSON.stringify(bundle).length > MAX_BUNDLE_BYTES && policy.includeBodies) {
    bundle = buildBundle({ ...input, policy: { ...policy, includeBodies: false } });
  }
  return bundle;
}

function fallbackGeometry(tab: chrome.tabs.Tab) {
  return {
    screenX: 0,
    screenY: 0,
    outerWidth: tab.width ?? 0,
    outerHeight: tab.height ?? 0,
    innerWidth: tab.width ?? 0,
    innerHeight: tab.height ?? 0,
    devicePixelRatio: 0,
    scrollX: 0,
    scrollY: 0,
  };
}

class CaptureError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

// ---------- native bridge ----------

type HostMessage =
  | { type: 'hello'; protocol: number; app?: { version: string; running: boolean } }
  | { type: 'ping'; id: string }
  | { type: 'capture.request'; id: string; policy?: Partial<CapturePolicy>; target?: CaptureTarget };

let port: chrome.runtime.Port | undefined;
let connected = false;
let lastError: string | undefined;
let retryDelay = 5_000;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

function connect(): void {
  if (port || retryTimer) return;
  try {
    port = chrome.runtime.connectNative(NATIVE_HOST);
  } catch (error) {
    lastError = String(error);
    scheduleReconnect();
    return;
  }
  port.onMessage.addListener((message: HostMessage) => void handleHost(message));
  port.onDisconnect.addListener(() => {
    lastError = chrome.runtime.lastError?.message ?? 'disconnected';
    port = undefined;
    connected = false;
    scheduleReconnect();
  });
  port.postMessage({ type: 'hello', protocol: PROTOCOL_VERSION, extensionVersion, browser: navigator.userAgent });
}

function scheduleReconnect(): void {
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    connect();
  }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 5 * 60_000);
}

async function handleHost(message: HostMessage): Promise<void> {
  connected = true;
  lastError = undefined;
  retryDelay = 5_000;
  if (message.type === 'ping') {
    port?.postMessage({ type: 'pong', id: message.id, protocol: PROTOCOL_VERSION, enabled: settings.enabled });
    return;
  }
  if (message.type === 'capture.request') {
    try {
      const bundle = await capture(message.policy, message.target);
      port?.postMessage({ type: 'capture.result', id: message.id, bundle });
    } catch (error) {
      const code = error instanceof CaptureError ? error.code : 'internal';
      port?.postMessage({ type: 'capture.error', id: message.id, code, message: String((error as Error).message ?? error) });
    }
  }
}

chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
connect();

// ---------- popup ----------

type PopupMessage =
  | { type: 'status' }
  | { type: 'export'; policy?: Partial<CapturePolicy>; target?: CaptureTarget }
  | { type: 'reconnect' };

chrome.runtime.onMessage.addListener((message: PopupMessage, sender, respond) => {
  // Only extension pages, never content scripts.
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return false;
  if (message.type === 'status') {
    respond({ connected, lastError, enabled: settings.enabled, host: NATIVE_HOST });
    return false;
  }
  if (message.type === 'reconnect') {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = undefined;
    retryDelay = 5_000;
    port?.disconnect();
    port = undefined;
    connect();
    respond({ ok: true });
    return false;
  }
  if (message.type === 'export') {
    capture(message.policy, message.target)
      .then((bundle) => respond({ ok: true, bundle }))
      .catch((error) => respond({ ok: false, error: String(error.message ?? error) }));
    return true;
  }
  return false;
});
