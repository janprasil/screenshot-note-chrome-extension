import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBackground, loadContent } from './fake-chrome.ts';

const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));
const FLUSH_MS = 1_100;

const login = (tabId = 1) => ({
  requestId: 'login',
  tabId,
  url: 'https://app.example.com/login',
  method: 'POST',
  type: 'main_frame',
  timeStamp: Date.now(),
  requestBody: { formData: { username: ['jan'], password: ['hunter2'] } },
});

const bodyListenerSpec = (bg: Awaited<ReturnType<typeof loadBackground>>) =>
  bg.chrome.webRequest.onBeforeRequest.listeners.map((listener) => listener.spec ?? []);

test('request bodies are neither requested nor stored while body recording is off', async () => {
  const bg = await loadBackground({ settings: { enabled: true, recordBodies: false, bufferMs: 300_000 } });
  await tick();
  assert.ok(bodyListenerSpec(bg).every((spec) => !spec.includes('requestBody')));

  bg.chrome.webRequest.onBeforeRequest.fire(login());
  await tick(FLUSH_MS);
  const stored = bg.session.data['net:1'] as any[];
  assert.equal(stored.length, 1);
  assert.equal(stored[0].requestBody, undefined);
});

test('switching body recording off clears stored bodies', async () => {
  const bg = await loadBackground({ settings: { enabled: true, recordBodies: true, bufferMs: 300_000 } });
  await tick();
  assert.ok(bodyListenerSpec(bg).some((spec) => spec.includes('requestBody')));
  bg.chrome.webRequest.onBeforeRequest.fire(login());
  await tick(FLUSH_MS);
  assert.match((bg.session.data['net:1'] as any[])[0].requestBody, /hunter2/);

  await bg.local.set({ settings: { enabled: true, recordBodies: false, bufferMs: 300_000 } });
  await tick(FLUSH_MS);
  assert.ok(bodyListenerSpec(bg).every((spec) => !spec.includes('requestBody')));
  assert.equal((bg.session.data['net:1'] as any[])[0].requestBody, undefined);

  await bg.local.set({ settings: { enabled: true, recordBodies: true, bufferMs: 300_000 } });
  assert.ok(bodyListenerSpec(bg).some((spec) => spec.includes('requestBody')));
});

test('bodies restored from session storage are dropped when body recording is off', async () => {
  const bg = await loadBackground({
    settings: { enabled: true, recordBodies: false, bufferMs: 300_000 },
    session: { 'net:1': [{ requestId: 'old', tabId: 1, url: 'https://app.example.com/login', method: 'POST', type: 'main_frame', startTime: Date.now(), time: Date.now(), requestBody: 'password=hunter2' }] },
  });
  await tick(FLUSH_MS);
  const stored = bg.session.data['net:1'] as any[];
  assert.equal(stored.length, 1);
  assert.equal(stored[0].requestBody, undefined);
});

test('content script drops page bodies while body recording is off and clears them when switched off', async () => {
  const content = await loadContent({ enabled: true, recordBodies: false, bufferMs: 300_000 });
  content.emit({ kind: 'request', time: Date.now(), api: 'fetch', method: 'POST', url: 'https://app.example.com/api', requestBody: 'password=x', responseBody: '{"token":"y"}' });
  let collected = await content.collect();
  assert.equal(collected.entries.length, 1);
  assert.equal(collected.entries[0].requestBody, undefined);
  assert.equal(collected.entries[0].responseBody, undefined);

  await content.local.set({ settings: { enabled: true, recordBodies: true, bufferMs: 300_000 } });
  content.emit({ kind: 'request', time: Date.now(), api: 'fetch', method: 'POST', url: 'https://app.example.com/api', requestBody: 'a=1' });
  collected = await content.collect();
  assert.equal(collected.entries[1].requestBody, 'a=1');

  await content.local.set({ settings: { enabled: true, recordBodies: false, bufferMs: 300_000 } });
  collected = await content.collect();
  assert.ok(collected.entries.every((entry: any) => entry.requestBody === undefined));
});
