import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBundle } from '../src/lib/capture.ts';
import { DEFAULT_POLICY } from '../src/lib/defaults.ts';
import { serializeArg } from '../src/lib/serialize.ts';
import type { PageInfo } from '../src/lib/types.ts';

const page: PageInfo = {
  url: 'https://app.example.com/?access_token=x',
  title: 'App',
  userAgent: 'test',
  language: 'cs',
  geometry: { screenX: 0, screenY: 0, outerWidth: 1200, outerHeight: 800, innerWidth: 1200, innerHeight: 700, devicePixelRatio: 2, scrollX: 0, scrollY: 0 },
};

test('bundle summarizes errors and respects include switches', () => {
  const bundle = buildBundle({
    page,
    entries: [
      { kind: 'console', time: 1, level: 'error', args: ['boom'], url: page.url },
      { kind: 'console', time: 2, level: 'warn', args: ['hm'], url: page.url },
      { kind: 'error', time: 3, message: 'TypeError', unhandledRejection: false, url: page.url },
    ],
    elements: [{ selector: '#a', tag: 'button', text: 'Uložit', rect: { x: 1, y: 2, width: 3, height: 4 }, depth: 1 }],
    network: [{ requestId: '1', tabId: 1, url: 'https://api.example.com/x', method: 'GET', type: 'fetch', startTime: 1, statusCode: 404 }],
    policy: { ...DEFAULT_POLICY, includeElementText: false },
    extensionVersion: '0.1.0',
    now: 0,
  });
  assert.equal(bundle.summary.consoleErrors, 1);
  assert.equal(bundle.summary.consoleWarnings, 1);
  assert.equal(bundle.summary.uncaughtErrors, 1);
  assert.equal(bundle.summary.failedRequests[0].status, 404);
  assert.match(bundle.page.url, /access_token=%5Bredacted%5D/);
  assert.equal(bundle.elements?.[0].text, undefined);

  const minimal = buildBundle({ page, entries: [], network: [], policy: { ...DEFAULT_POLICY, includeNetwork: false, includeElements: false }, extensionVersion: '0.1.0' });
  assert.equal(minimal.har, undefined);
  assert.equal(minimal.elements, undefined);
});

test('console serialization survives cycles and errors', () => {
  const cyclic: Record<string, unknown> = { a: 1 };
  cyclic.self = cyclic;
  assert.equal(serializeArg(cyclic), '{"a": 1, "self": [Circular]}');
  assert.match(serializeArg(new Error('x')), /^Error: x/);
  assert.equal(serializeArg('plain'), 'plain');
});
