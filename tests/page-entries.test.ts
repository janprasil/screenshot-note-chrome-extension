import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_POLICY } from '../src/lib/defaults.ts';
import { buildBundle } from '../src/lib/capture.ts';
import { buildHar } from '../src/lib/har.ts';
import { loadContent } from './fake-chrome.ts';

const page = { url: 'https://a.example/', title: 'T', userAgent: 'u', language: 'cs', geometry: { screenX: 0, screenY: 0, outerWidth: 1, outerHeight: 1, innerWidth: 1, innerHeight: 1, devicePixelRatio: 1, scrollX: 0, scrollY: 0 } };

test('content script validates page-provided entries', async () => {
  const content = await loadContent();
  const before = Date.now();
  content.emit({ kind: 'request', time: 1e300, api: 'fetch', method: 'GET', url: 'https://a.example/x' });
  content.emit({ kind: 'request', time: before, api: 'fetch', method: 1, url: 'https://a.example/y' });
  content.emit({ kind: 'bogus', time: before });
  content.emit({ kind: 'console', time: before, level: 'log', args: ['x'.repeat(10_000)], url: 'https://a.example/' });
  content.emit({ kind: 'request', time: before, api: 'xhr', method: 'POST', url: 'https://a.example/big', status: -5, durationMs: -1e300, requestBody: 'a'.repeat(300_000) });
  content.emit({ kind: 'console', time: before, level: 'nope', args: 'x', url: 5 });
  const { entries } = await content.collect();
  assert.ok(entries.every((entry: any) => entry.time <= Date.now()), 'time clamped');
  assert.ok(entries.every((entry: any) => ['console', 'error', 'request'].includes(entry.kind)));
  assert.ok(entries.every((entry: any) => entry.kind !== 'request' || typeof entry.method === 'string'));
  assert.ok(entries.every((entry: any) => JSON.stringify(entry).length < 600_000), 'entry size capped');
  assert.ok(entries.some((entry: any) => entry.url === 'https://a.example/x'));
  const long = entries.find((entry: any) => entry.kind === 'console' && entry.level === 'log');
  assert.ok(long.args[0].length <= 4_100);
  const big = entries.find((entry: any) => entry.url === 'https://a.example/big');
  assert.equal(big.status, undefined);
  assert.equal(big.durationMs, 0);

  // Bundle z ošetřených záznamů se postaví bez výjimky.
  const bundle = buildBundle({ page, entries, network: [], policy: DEFAULT_POLICY, extensionVersion: '0' });
  assert.ok(bundle.har);
});

test('content buffer is capped in bytes', async () => {
  const content = await loadContent();
  for (let index = 0; index < 400; index++) {
    content.emit({ kind: 'console', time: Date.now(), level: 'log', args: Array.from({ length: 50 }, () => 'y'.repeat(4_000)), url: 'https://a.example/' });
  }
  const { entries } = await content.collect();
  assert.ok(JSON.stringify(entries).length <= 9 * 1024 * 1024, `buffer ${JSON.stringify(entries).length}`);
  assert.ok(entries.length > 0 && entries.length < 400);
});

test('ring buffer keeps size accounting through push, prune and replace', async () => {
  const { RingBuffer } = await import('../src/lib/ring-buffer.ts');
  const buffer = new RingBuffer<{ time: number; size: number }>(10, 1_000, 10, (item) => item.size);
  buffer.push({ time: 1, size: 20 });
  assert.equal(buffer.size, 0);
  for (let time = 1; time <= 4; time++) buffer.push({ time, size: 4 });
  assert.deepEqual(buffer.toArray().map((item) => item.time), [3, 4]);
  buffer.prune(1_003.5);
  assert.deepEqual(buffer.toArray().map((item) => item.time), [4]);
  buffer.replace([{ time: 5, size: 2 }, { time: 6, size: 30 }, { time: 7, size: 3 }]);
  assert.deepEqual(buffer.toArray().map((item) => item.time), [5, 7]);
  buffer.push({ time: 8, size: 6 });
  assert.deepEqual(buffer.toArray().map((item) => item.time), [7, 8]);
});

test('HAR skips entries it cannot build instead of failing', () => {
  const har = buildHar({
    network: [{ requestId: '1', tabId: 1, url: 'https://a.example/x', method: 'GET', type: 'fetch', startTime: 1_000 }],
    pageRequests: [
      { kind: 'request', time: 1e300, api: 'fetch', method: 'GET', url: 'https://a.example/z' },
      { kind: 'request', time: 1_000, api: 'fetch', method: 1, url: 'https://a.example/x' } as any,
      { kind: 'request', time: 2_000, api: 'fetch', method: 'POST', url: 'https://a.example/ok' },
    ],
    pageUrl: 'https://a.example/', pageTitle: 'T', extensionVersion: '0', policy: DEFAULT_POLICY,
  }) as any;
  const urls = har.log.entries.map((entry: any) => entry.request.url);
  assert.ok(urls.includes('https://a.example/x'));
  assert.ok(urls.includes('https://a.example/ok'));
});
