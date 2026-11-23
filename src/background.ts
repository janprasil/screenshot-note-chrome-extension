// Service worker: records webRequest traffic per tab and serves capture requests from the Mac app.
import { MAX_BUNDLE_BYTES, buildFittingBundle } from './lib/capture.ts';
import { DEFAULT_SETTINGS, NATIVE_HOST, PROTOCOL_VERSION, normalizePolicy } from './lib/defaults.ts';
import { BODY_TRUNCATED } from './lib/redact.ts';
import { RingBuffer } from './lib/ring-buffer.ts';
import type { CaptureBundle, CapturePolicy, Header, NetworkEntry, RecorderSettings, Rect } from './lib/types.ts';
import type { CollectRequest, CollectResponse } from './content.ts';

type Stored = NetworkEntry & { time: number };

const MAX_PER_TAB = 500;
const MAX_REQUEST_BODY = 64 * 1024;
// Per-tab cap in characters, because the entry count alone does not bound memory.
const MAX_TAB_CHARS = 4 * 1024 * 1024;
const extensionVersion = chrome.runtime.getManifest().version;

// Nothing is recorded until settings load; the user may have switched recording off.
let settings: RecorderSettings = { ...DEFAULT_SETTINGS, enabled: false };
const tabs = new Map<number, { buffer: RingBuffer<Stored>; byId: Map<string, Stored> }>();
const dirty = new Set<number>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;

// ---------- settings and persistence ----------

const ready = (async () => {
  const { settings: stored } = await chrome.storage.local.get('settings');
  settings = { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
  registerBodyListener();
  void syncPageRecorder(false);
  const saved = await chrome.storage.session.get(null);
  for (const [key, value] of Object.entries(saved)) {
    if (!key.startsWith('net:')) continue;
    const tabId = Number(key.slice(4));
    const state = tabState(tabId);
    state.buffer.replace(value as Stored[]);
    // After the worker wakes up, expired entries are pruned from session storage too.
    state.buffer.prune();
    for (const entry of state.buffer.toArray()) state.byId.set(entry.requestId, entry);
    markDirty(tabId);
  }
  if (!settings.recordBodies) clearBodies();
})();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  const wasEnabled = settings.enabled;
  settings = { ...DEFAULT_SETTINGS, ...(changes.settings.newValue ?? {}) };
  void syncPageRecorder(!wasEnabled && settings.enabled);
  for (const state of tabs.values()) state.buffer.setMaxAge(settings.bufferMs);
  registerBodyListener();
  if (!settings.recordBodies) clearBodies();
  if (!settings.enabled) {
    tabs.clear();
    void chrome.storage.session.clear();
  }
});

// ---------- page recorder (MAIN world) ----------

const PAGE_RECORDER_ID = 'page-recorder';

/** The MAIN script is in pages only while recording is on; switching on adds it to open tabs. */
async function syncPageRecorder(injectOpenTabs: boolean): Promise<void> {
  try {
    const registered = (await chrome.scripting.getRegisteredContentScripts({ ids: [PAGE_RECORDER_ID] })).length > 0;
    if (settings.enabled && !registered) {
      await chrome.scripting.registerContentScripts([
        { id: PAGE_RECORDER_ID, js: ['inject.js'], matches: ['<all_urls>'], runAt: 'document_start', world: 'MAIN', persistAcrossSessions: true },
      ]);
    }
    if (!settings.enabled && registered) await chrome.scripting.unregisterContentScripts({ ids: [PAGE_RECORDER_ID] });
  } catch {
    // Registration is retried on the next settings change or worker start.
  }
  if (!settings.enabled || !injectOpenTabs) return;
  for (const tab of await chrome.tabs.query({})) {
    if (tab.id === undefined || !/^https?:/.test(tab.url ?? '')) continue;
    // Tabs without a content script or with a connected recorder are skipped.
    const status = (await chrome.tabs.sendMessage(tab.id, { type: 'recorder-status' }, { frameId: 0 }).catch(() => undefined)) as { connected?: boolean } | undefined;
    if (!status || status.connected) continue;
    await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, world: 'MAIN', files: ['inject.js'] }).catch(() => undefined);
  }
}

function tabState(tabId: number) {
  let state = tabs.get(tabId);
  if (!state) {
    state = { buffer: new RingBuffer<Stored>(MAX_PER_TAB, settings.bufferMs, MAX_TAB_CHARS, storedSize), byId: new Map() };
    tabs.set(tabId, state);
  }
  return state;
}

/** Approximate entry size in characters. */
function storedSize(entry: Stored): number {
  let size = 200 + entry.url.length + (entry.requestBody?.length ?? 0) + (entry.error?.length ?? 0);
  for (const header of [...(entry.requestHeaders ?? []), ...(entry.responseHeaders ?? [])]) size += header.name.length + header.value.length;
  return size;
}

/** The entry changed after insertion; recompute its size and persist it. */
function changed(tabId: number, entry: Stored): void {
  tabs.get(tabId)?.buffer.resize(entry);
  markDirty(tabId);
}

function markDirty(tabId: number): void {
  dirty.add(tabId);
  flushTimer ??= setTimeout(flush, 1_000);
}

// Session storage is memory-only, it survives service worker restarts but not browser restarts.
async function flush(): Promise<boolean> {
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
    return true;
  } catch {
    // Quota exceeded, the in-memory buffer still works.
    return false;
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

const pendingBodies = new Map<string, string>();

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
    };
    const body = pendingBodies.get(details.requestId);
    pendingBodies.delete(details.requestId);
    if (body !== undefined && settings.recordBodies) entry.requestBody = body;
    state.buffer.push(entry);
    state.byId.set(entry.requestId, entry);
    markDirty(details.tabId);
  },
  filter,
);

// Bodies come from a separate listener, registered only while body recording is on.
function onRequestBody(details: chrome.webRequest.WebRequestBodyDetails): void {
  if (!settings.enabled || !settings.recordBodies || details.tabId < 0) return;
  const body = requestBodyText(details.requestBody);
  if (body === undefined) return;
  const entry = tabs.get(details.tabId)?.byId.get(details.requestId);
  if (entry) {
    entry.requestBody = body;
    changed(details.tabId, entry);
    return;
  }
  // Listener order is not guaranteed; the main listener picks up the body.
  pendingBodies.set(details.requestId, body);
  if (pendingBodies.size > 100) pendingBodies.delete(pendingBodies.keys().next().value!);
}

function registerBodyListener(): void {
  const listening = chrome.webRequest.onBeforeRequest.hasListener(onRequestBody);
  if (settings.recordBodies && !listening) chrome.webRequest.onBeforeRequest.addListener(onRequestBody, filter, ['requestBody']);
  if (!settings.recordBodies && listening) chrome.webRequest.onBeforeRequest.removeListener(onRequestBody);
}

function clearBodies(): void {
  pendingBodies.clear();
  let found = false;
  for (const [tabId, state] of tabs) {
    for (const entry of state.buffer.toArray()) {
      if (entry.requestBody === undefined) continue;
      delete entry.requestBody;
      state.buffer.resize(entry);
      dirty.add(tabId);
      found = true;
    }
  }
  if (!found) return;
  // Stored bodies are cleared right away; on failure the session entries are deleted.
  if (flushTimer) clearTimeout(flushTimer);
  void flush().then((ok) => {
    if (!ok) void chrome.storage.session.remove([...tabs.keys()].map((tabId) => `net:${tabId}`));
  });
}

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const entry = entryFor(details);
    if (!entry) return;
    entry.requestHeaders = headers(details.requestHeaders);
    changed(details.tabId, entry);
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
    changed(details.tabId, entry);
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
  changed(details.tabId, entry);
}, filter);

function headers(list: chrome.webRequest.HttpHeader[] | undefined): Header[] | undefined {
  return list?.map((header) => ({ name: header.name, value: header.value ?? '[binary]' }));
}

function requestBodyText(body: chrome.webRequest.WebRequestBody | null | undefined): string | undefined {
  if (!body) return undefined;
  if (body.formData) {
    // The form is built incrementally so a huge field cannot pass the limit.
    const fields: string[] = [];
    let length = 0;
    for (const [key, values] of Object.entries(body.formData)) {
      for (const value of values) {
        const field = `${encodeURIComponent(key)}=${encodeURIComponent(String(value).slice(0, MAX_REQUEST_BODY + 1))}`;
        length += field.length + 1;
        if (length > MAX_REQUEST_BODY) return BODY_TRUNCATED;
        fields.push(field);
      }
    }
    return fields.join('&');
  }
  if (body.raw && body.raw.length > 1) return body.raw.some((part) => part.file) ? '[file upload]' : BODY_TRUNCATED;
  const bytes = body.raw?.find((part) => part.bytes)?.bytes;
  if (!bytes) return body.raw?.length ? '[file upload]' : undefined;
  // A truncated body cannot be redacted reliably, so only a marker is sent.
  if (bytes.byteLength > MAX_REQUEST_BODY) return BODY_TRUNCATED;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
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

/** Target tab; an incognito tab is rejected, never replaced by another. */
async function findTab(input: unknown): Promise<chrome.tabs.Tab | undefined> {
  const tab = await pickTab(input);
  return tab?.incognito ? undefined : tab;
}

async function pickTab(input: unknown): Promise<chrome.tabs.Tab | undefined> {
  let target = parseTarget(input);
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal', 'popup', 'app'] });
  const activeTab = (window: chrome.windows.Window) => window.tabs?.find((tab) => tab.active);

  // A direct tabId applies only to an active tab of a window, otherwise the target is ignored.
  if (target?.tabId !== undefined) {
    const tab = windows.map(activeTab).find((candidate) => candidate?.id === target?.tabId);
    if (tab) return tab;
    target = undefined;
  }

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

function parseTarget(input: unknown): CaptureTarget | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const raw = input as Record<string, unknown>;
  const target: CaptureTarget = {};
  const bounds = raw.windowBounds as Record<string, unknown> | undefined;
  if (bounds && typeof bounds === 'object' && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(bounds[key]))) {
    target.windowBounds = { x: bounds.x as number, y: bounds.y as number, width: bounds.width as number, height: bounds.height as number };
  }
  if (typeof raw.windowTitle === 'string') target.windowTitle = raw.windowTitle;
  if (raw.tabId !== undefined) {
    // An invalid tabId drops the whole target, like an inactive tab.
    if (!Number.isInteger(raw.tabId)) return undefined;
    target.tabId = raw.tabId as number;
  }
  return target;
}

async function capture(policyInput: unknown, target?: unknown): Promise<CaptureBundle> {
  await ready;
  if (!settings.enabled) throw new CaptureError('disabled', 'Recording is turned off in the extension.');
  const policy = normalizePolicy(policyInput, settings);
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

  const bundle = buildFittingBundle(input);
  if (!bundle) throw new CaptureError('too-large', `Context does not fit into ${MAX_BUNDLE_BYTES} bytes.`);
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
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
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
  if (!message || typeof message !== 'object') return;
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
