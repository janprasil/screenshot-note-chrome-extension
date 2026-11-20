// Isolated-world content script: buffers page events and answers collect requests.
import { DEFAULT_SETTINGS } from './lib/defaults.ts';
import { collectElements, pageGeometry } from './lib/elements.ts';
import { RingBuffer } from './lib/ring-buffer.ts';
import type { PageEntry, PageInfo, RecorderSettings } from './lib/types.ts';

const ENTRY_EVENT = 'screenshot-note:entry';
const CONFIG_EVENT = 'screenshot-note:config';

export interface CollectRequest {
  type: 'collect';
  since: number;
  includeElements: boolean;
  includeElementText: boolean;
}

export interface CollectResponse {
  page: PageInfo;
  entries: PageEntry[];
  elements?: ReturnType<typeof collectElements>;
}

const buffer = new RingBuffer<PageEntry>(2_000, DEFAULT_SETTINGS.bufferMs);
let settings: RecorderSettings = DEFAULT_SETTINGS;

document.addEventListener(ENTRY_EVENT, (event) => {
  if (!settings.enabled) return;
  try {
    const entry = JSON.parse(String((event as CustomEvent).detail)) as PageEntry;
    if (entry && typeof entry.time === 'number') buffer.push(entry);
  } catch {
    // The page can dispatch this event too, ignore garbage.
  }
});

function applySettings(next: RecorderSettings): void {
  settings = { ...DEFAULT_SETTINGS, ...next };
  buffer.setMaxAge(settings.bufferMs);
  if (!settings.enabled) buffer.clear();
  document.dispatchEvent(new CustomEvent(CONFIG_EVENT, { detail: JSON.stringify(settings) }));
}

chrome.storage.local.get('settings').then(({ settings: stored }) => applySettings(stored ?? DEFAULT_SETTINGS));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) applySettings(changes.settings.newValue ?? DEFAULT_SETTINGS);
});

chrome.runtime.onMessage.addListener((message: CollectRequest, _sender, respond) => {
  if (message?.type !== 'collect' || window.top !== window) return false;
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
    elements: message.includeElements ? collectElements(message.includeElementText) : undefined,
  };
  respond(response);
  return false;
});
