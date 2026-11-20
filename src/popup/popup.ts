import { DEFAULT_SETTINGS } from '../lib/defaults.ts';
import type { CaptureBundle, RecorderSettings } from '../lib/types.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

for (const element of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
  element.textContent = chrome.i18n.getMessage(element.dataset.i18n!);
}

async function load(): Promise<void> {
  const { settings: stored } = await chrome.storage.local.get('settings');
  const settings: RecorderSettings = { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
  $<HTMLInputElement>('enabled').checked = settings.enabled;
  $<HTMLInputElement>('recordBodies').checked = settings.recordBodies;
  $<HTMLSelectElement>('bufferMs').value = String(settings.bufferMs);
  await refreshStatus();
}

async function save(): Promise<void> {
  const settings: RecorderSettings = {
    enabled: $<HTMLInputElement>('enabled').checked,
    recordBodies: $<HTMLInputElement>('recordBodies').checked,
    bufferMs: Number($<HTMLSelectElement>('bufferMs').value),
  };
  await chrome.storage.local.set({ settings });
}

async function refreshStatus(): Promise<void> {
  const status = await chrome.runtime.sendMessage({ type: 'status' });
  $('dot').classList.toggle('on', Boolean(status?.connected));
  $('status').textContent = chrome.i18n.getMessage(status?.connected ? 'appConnected' : 'appDisconnected');
  $('status').title = status?.lastError ?? '';
}

function showError(message: string): void {
  const element = $('error');
  element.textContent = `${chrome.i18n.getMessage('exportFailed')}: ${message}`;
  element.hidden = false;
}

async function exportBundle(): Promise<void> {
  $('error').hidden = true;
  const result = (await chrome.runtime.sendMessage({ type: 'export' })) as { ok: boolean; bundle?: CaptureBundle; error?: string };
  if (!result?.ok || !result.bundle) return showError(result?.error ?? 'unknown');
  const stamp = result.bundle.capturedAt.replace(/[:.]/g, '-');
  download(`screenshot-note-context-${stamp}.json`, result.bundle);
  if (result.bundle.har) download(`screenshot-note-${stamp}.har`, result.bundle.har);
}

function download(name: string, data: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

for (const id of ['enabled', 'recordBodies', 'bufferMs']) $(id).addEventListener('change', () => void save());
$('export').addEventListener('click', () => void exportBundle().catch((error) => showError(String(error))));
$('reconnect').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'reconnect' });
  setTimeout(() => void refreshStatus(), 1_000);
});

void load();
