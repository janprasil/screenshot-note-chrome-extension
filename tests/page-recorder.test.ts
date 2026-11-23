import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBackground, loadContent } from './fake-chrome.ts';

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

/** Čeká na podmínku místo pevné pauzy, zprávy přes porty jsou asynchronní. */
async function until(check: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await tick(5);
}

test('content script hands the channel to the MAIN script and sends config through it', async () => {
  const content = await loadContent({ enabled: true, recordBodies: true, bufferMs: 300_000 });
  await until(() => content.config.length > 0);
  assert.deepEqual((await content.status()).connected, true);
  assert.deepEqual(content.config.at(-1), { type: 'config', enabled: true, recordBodies: true });

  await content.local.set({ settings: { enabled: false, recordBodies: true, bufferMs: 300_000 } });
  await until(() => content.config.at(-1)?.enabled === false);
  assert.deepEqual(content.config.at(-1), { type: 'config', enabled: false, recordBodies: true });
});

test('handshake survives READY and HELLO crossing in flight', async () => {
  const content = await loadContent(undefined, { mainFirst: true });
  await until(() => content.config.length > 0);
  assert.equal((await content.status()).connected, true);
  content.emit({ kind: 'console', time: Date.now(), level: 'log', args: ['after race'], url: 'https://app.example.com/' });
  const { entries } = await content.collect();
  assert.equal(entries.at(-1).args[0], 'after race');
});

test('a page cannot take over the channel once it is connected', async () => {
  const content = await loadContent();
  let stolen: unknown;
  content.window.addEventListener('message', (event: any) => {
    if (event.data?.type === 'screenshot-note:hello') stolen = event.ports[0];
  });
  content.window.postMessage({ type: 'screenshot-note:ready' }, '*');
  await tick();
  assert.equal(stolen, undefined, 'no new handshake after connect');

  content.emit({ kind: 'console', time: Date.now(), level: 'log', args: ['still recorded'], url: 'https://app.example.com/' });
  const { entries } = await content.collect();
  assert.equal(entries.at(-1).args[0], 'still recorded');
});

test('page recorder is registered only while recording is enabled', async () => {
  const bg = await loadBackground({ settings: { enabled: true, recordBodies: false, bufferMs: 300_000 }, recorderStatus: () => ({ connected: false }) });
  await tick();
  const scripting = bg.chrome.scripting;
  assert.equal(scripting.registered.length, 1);
  assert.equal(scripting.registered[0].world, 'MAIN');
  assert.equal(scripting.injected.length, 0, 'no injection on worker start');

  await bg.local.set({ settings: { enabled: false, recordBodies: false, bufferMs: 300_000 } });
  await tick();
  assert.equal(scripting.registered.length, 0);

  // Po zapnutí se recorder doplní do otevřených záložek bez připojeného recorderu.
  await bg.local.set({ settings: { enabled: true, recordBodies: false, bufferMs: 300_000 } });
  await tick();
  assert.equal(scripting.registered.length, 1);
  assert.equal(scripting.injected.length, 1);
  assert.equal(scripting.injected[0].world, 'MAIN');
});

test('open tabs that already have a recorder are not injected twice', async () => {
  const bg = await loadBackground({ settings: { enabled: false, recordBodies: false, bufferMs: 300_000 }, recorderStatus: () => ({ connected: true }) });
  await tick();
  await bg.local.set({ settings: { enabled: true, recordBodies: false, bufferMs: 300_000 } });
  await tick();
  assert.equal(bg.chrome.scripting.injected.length, 0);
});
