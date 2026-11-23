// Isolated-world content script: buffers page events and answers collect requests.
import { DEFAULT_SETTINGS } from './lib/defaults.ts';
import { collectElements, pageGeometry } from './lib/elements.ts';
import { CHANNEL_ACK, CHANNEL_HELLO, CHANNEL_READY, isChannelMessage, type ChannelConfig } from './lib/page-channel.ts';
import { MAX_BUFFER_CHARS, entrySize, sanitizePageEntry } from './lib/page-entry.ts';
import { RingBuffer } from './lib/ring-buffer.ts';
import type { PageEntry, PageInfo, RecorderSettings } from './lib/types.ts';

export interface CollectRequest {
  type: 'collect';
  since: number;
  includeElements: boolean;
  includeElementText: boolean;
}

export interface RecorderStatusRequest {
  type: 'recorder-status';
}

export interface CollectResponse {
  page: PageInfo;
  entries: PageEntry[];
  elements?: ReturnType<typeof collectElements>;
}

// Strop jedné události ještě před parsováním JSONu.
const MAX_EVENT_CHARS = 4 * 1024 * 1024;

const buffer = new RingBuffer<PageEntry>(2_000, DEFAULT_SETTINGS.bufferMs, MAX_BUFFER_CHARS, entrySize);
let settings: RecorderSettings = DEFAULT_SETTINGS;

let port: MessagePort | undefined;
// MAIN skript potvrdil port, další handshake se už nepřijme.
let connected = false;
// Nabídnuté porty čekají na ACK; MAIN si mohl vzít kterýkoli z nich.
let pending: MessagePort[] = [];
const MAX_PENDING = 4;

function onEntry(data: unknown): void {
  if (!settings.enabled || typeof data !== 'string' || data.length > MAX_EVENT_CHARS) return;
  try {
    const entry = sanitizePageEntry(JSON.parse(data));
    if (entry) buffer.push(settings.recordBodies ? entry : withoutBodies(entry));
  } catch {
    // Ignore garbage.
  }
}

function connect(): void {
  if (pending.length >= MAX_PENDING) return;
  const channel = new MessageChannel();
  const offered = channel.port1;
  pending.push(offered);
  offered.onmessage = (event: MessageEvent) => {
    if (typeof event.data === 'object' && event.data?.type === CHANNEL_ACK) {
      if (connected) return offered.close();
      connected = true;
      port = offered;
      for (const other of pending) if (other !== offered) other.close();
      pending = [];
      sendConfig();
      return;
    }
    if (offered === port) onEntry(event.data);
  };
  window.postMessage({ type: CHANNEL_HELLO }, '*', [channel.port2]);
}

function sendConfig(): void {
  const config: ChannelConfig = { type: 'config', enabled: settings.enabled, recordBodies: settings.recordBodies };
  if (connected) port?.postMessage(config);
}

window.addEventListener('message', (event) => {
  if (!connected && isChannelMessage(event, CHANNEL_READY)) connect();
});
connect();

function applySettings(next: RecorderSettings): void {
  settings = { ...DEFAULT_SETTINGS, ...next };
  buffer.setMaxAge(settings.bufferMs);
  if (!settings.enabled) buffer.clear();
  if (!settings.recordBodies) buffer.replace(buffer.toArray().map(withoutBodies));
  sendConfig();
}

// Bez zapnutého nahrávání těl se těla requestů neukládají.
function withoutBodies(entry: PageEntry): PageEntry {
  if (entry.kind !== 'request') return entry;
  const { requestBody: _request, responseBody: _response, truncated: _truncated, ...rest } = entry;
  return rest;
}

chrome.storage.local.get('settings').then(({ settings: stored }) => applySettings(stored ?? DEFAULT_SETTINGS));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) applySettings(changes.settings.newValue ?? DEFAULT_SETTINGS);
});

// DOM patří stránce, chyba v mapě elementů nesmí shodit celý collect.
function safeElements(includeText: boolean): ReturnType<typeof collectElements> | undefined {
  try {
    return collectElements(includeText);
  } catch {
    return undefined;
  }
}

chrome.runtime.onMessage.addListener((message: CollectRequest | RecorderStatusRequest, _sender, respond) => {
  if (window.top !== window) return false;
  if (message?.type === 'recorder-status') {
    respond({ connected });
    return false;
  }
  if (message?.type !== 'collect') return false;
  buffer.prune();
  const response: CollectResponse = {
    page: {
      url: location.href,
      title: document.title,
      userAgent: navigator.userAgent,
      language: navigator.language,
      geometry: pageGeometry(),
    },
    entries: buffer.since(message.since),
    elements: message.includeElements ? safeElements(message.includeElementText) : undefined,
  };
  respond(response);
  return false;
});
