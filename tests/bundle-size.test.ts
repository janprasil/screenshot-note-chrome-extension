import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_POLICY } from '../src/lib/defaults.ts';
import { MAX_BUNDLE_BYTES, buildFittingBundle, bundleBytes } from '../src/lib/capture.ts';
import { loadBackground } from './fake-chrome.ts';

const MAX = MAX_BUNDLE_BYTES;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

test('bundle is measured in UTF-8 bytes and trimmed under 16 MiB', async () => {
  const bg = await loadBackground({ settings: { enabled: true, recordBodies: false, bufferMs: 300_000 } });
  await tick();
  // Každá URL má 20 000 znaků, ale 40 000 bajtů v UTF-8.
  const path = 'ě'.repeat(20_000);
  for (let index = 0; index < 500; index++) {
    bg.chrome.webRequest.onBeforeRequest.fire({ requestId: String(index), tabId: 1, url: `https://a.example/${index}/${path}`, method: 'GET', type: 'image', timeStamp: Date.now() });
  }
  const reply = await bg.request({ type: 'capture.request', id: '1' });
  assert.equal(reply.type, 'capture.result');
  const size = bytes(reply.bundle);
  assert.ok(size <= MAX, `message is ${size} bytes`);
  assert.ok(reply.bundle.trimmed?.network > 0);
  const entries = reply.bundle.har.log.entries;
  assert.ok(entries.length > 0 && entries.length < 500);
  // Zůstanou nejnovější requesty.
  assert.ok(entries.some((entry: any) => entry.request.url.startsWith('https://a.example/499/')));
});

test('bundle that cannot be trimmed enough ends with capture.error too-large', async () => {
  const bg = await loadBackground({
    settings: { enabled: true, recordBodies: false, bufferMs: 300_000 },
    collect: () => ({
      page: { url: 'https://a.example/', title: 'ž'.repeat(9_000_000), userAgent: 'u', language: 'cs', geometry: { screenX: 0, screenY: 0, outerWidth: 1, outerHeight: 1, innerWidth: 1, innerHeight: 1, devicePixelRatio: 1, scrollX: 0, scrollY: 0 } },
      entries: [],
    }),
  });
  await tick();
  const reply = await bg.request({ type: 'capture.request', id: '1' });
  assert.equal(reply.type, 'capture.error');
  assert.equal(reply.code, 'too-large');
});

test('trimming drops bodies first, keeps the newest entries and the full summary', () => {
  const page = { url: 'https://a.example/', title: 'T', userAgent: 'u', language: 'cs', geometry: { screenX: 0, screenY: 0, outerWidth: 1, outerHeight: 1, innerWidth: 1, innerHeight: 1, devicePixelRatio: 1, scrollX: 0, scrollY: 0 } };
  const network = Array.from({ length: 40 }, (_, index) => ({ requestId: String(index), tabId: 1, url: `https://a.example/${index}`, method: 'GET', type: 'image', startTime: 1_000 + index, statusCode: 500 }));
  const entries = Array.from({ length: 40 }, (_, index) => ({ kind: 'console' as const, time: 1_000 + index, level: 'error' as const, args: ['x'.repeat(500)], url: page.url }));
  const elements = [{ selector: '#a', tag: 'button', rect: { x: 0, y: 0, width: 1, height: 1 }, depth: 0 }];
  const input = { page, network, entries, elements, policy: { ...DEFAULT_POLICY, includeBodies: true }, extensionVersion: '0', now: 0 };

  const withBody = { ...input, network: [{ ...network[0], requestBody: JSON.stringify({ a: 'b'.repeat(20_000) }) }] , entries: [] };
  const small = bundleBytes(buildFittingBundle({ ...withBody, policy: { ...withBody.policy, includeBodies: false } }));
  const noBodies = buildFittingBundle(withBody, small + 100)!;
  assert.equal(noBodies.policy.includeBodies, false);
  assert.equal(noBodies.trimmed?.bodies, true);
  assert.equal(noBodies.trimmed?.network, 0);

  const limit = Math.floor(bundleBytes(buildFittingBundle(input)) / 3);
  const bundle = buildFittingBundle(input, limit)!;
  assert.ok(bundleBytes(bundle) <= limit);
  assert.ok(bundle.trimmed!.network > 0 && bundle.trimmed!.console > 0);
  assert.equal(bundle.summary.consoleErrors, 40);
  assert.equal(bundle.summary.requestCount, 40);
  assert.equal(bundle.elements?.length, 1);
  const urls = (bundle.har as any).log.entries.map((entry: any) => entry.request.url);
  assert.ok(urls.includes('https://a.example/39'));
  assert.ok(!urls.includes('https://a.example/0'));
  assert.equal(bundle.console.at(-1)?.time, 1_039);
});
