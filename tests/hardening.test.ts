import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBundle } from '../src/lib/capture.ts';
import { DEFAULT_POLICY } from '../src/lib/defaults.ts';
import { NESTED_OMITTED, redactBody, redactSecretsInText } from '../src/lib/redact.ts';
import { RingBuffer } from '../src/lib/ring-buffer.ts';
import { serializeArg } from '../src/lib/serialize.ts';
import type { PageInfo } from '../src/lib/types.ts';
import { loadBackground } from './fake-chrome.ts';

const policy = { ...DEFAULT_POLICY, includeBodies: true };
const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));
const page: PageInfo = {
  url: 'https://a.example/',
  title: 'T',
  userAgent: 'u',
  language: 'cs',
  geometry: { screenX: 0, screenY: 0, outerWidth: 1, outerHeight: 1, innerWidth: 1, innerHeight: 1, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
};

test('JSON nested past the depth limit is omitted, not passed through', () => {
  let value: unknown = { password: 'SECRET' };
  for (let index = 0; index < 4; index++) value = { data: JSON.stringify(value) };
  const text = redactBody(JSON.stringify(value), policy).text!;
  assert.doesNotMatch(text, /SECRET/);
  assert.ok(text.includes(NESTED_OMITTED));
});

test('broken nested JSON with keys is omitted, plain text stays', () => {
  const text = redactBody(JSON.stringify({ data: '{"password":"SECRET"', note: '[INFO] ok' }), policy).text!;
  assert.doesNotMatch(text, /SECRET/);
  assert.match(text, /\[INFO\] ok/);
});

test('secrets in free text are redacted', () => {
  const text = redactSecretsInText('{"Authorization": "Bearer abcdefghijkl", "password": "SECRET", "otp": 1234, "user": "jan"} GET https://a.example/?access_token=TOKEN', DEFAULT_POLICY);
  assert.doesNotMatch(text, /abcdefghijkl|SECRET|1234|TOKEN/);
  assert.match(text, /"user": "jan"/);
  assert.match(redactSecretsInText('Authorization: Bearer abcdefghijkl', DEFAULT_POLICY), /Bearer \[redacted\]/);
});

test('console arguments and network errors are redacted in the bundle', () => {
  const bundle = buildBundle({
    page,
    entries: [
      { kind: 'console', time: 1, level: 'log', args: [serializeArg({ headers: { Authorization: 'Bearer abcdefghijkl' } }), 'GET https://a.example/?token=TOKEN'], url: page.url },
      { kind: 'error', time: 2, message: 'Failed {"password": "SECRET"}', unhandledRejection: false, url: page.url },
      { kind: 'request', time: 3, api: 'fetch', method: 'GET', url: 'https://b.example/x', error: 'Failed https://b.example/?token=PAGE' },
    ],
    network: [{ requestId: '1', tabId: 1, url: 'https://c.example/y', method: 'GET', type: 'xmlhttprequest', startTime: 1, error: 'net::ERR https://c.example/?token=NET' }],
    policy: DEFAULT_POLICY,
    extensionVersion: '0',
    now: 0,
  });
  const text = JSON.stringify(bundle);
  assert.doesNotMatch(text, /abcdefghijkl|TOKEN|SECRET|PAGE|NET\b/);
});

test('serializing a huge object stays bounded and fast', () => {
  const wide = (depth: number): Record<string, unknown> =>
    Object.fromEntries(Array.from({ length: 50 }, (_, index) => [`k${index}`, depth === 0 ? 'v'.repeat(100) : wide(depth - 1)]));
  const value = wide(3);
  const start = performance.now();
  const text = serializeArg(value);
  assert.ok(performance.now() - start < 200, 'serialization took too long');
  assert.ok(text.length <= 4_100);
  assert.ok(serializeArg('x'.repeat(1_000_000)).length < 4_100);
});

test('ring buffer recounts an entry that grew after push', () => {
  const buffer = new RingBuffer<{ time: number; size: number }>(10, 60_000, 100, (item) => item.size);
  const first = { time: Date.now(), size: 10 };
  const second = { time: Date.now(), size: 10 };
  buffer.push(first);
  buffer.push(second);
  second.size = 95;
  buffer.resize(second);
  assert.deepEqual(buffer.toArray(), [second]);
});

test('oversized form bodies are replaced by a marker', async () => {
  const bg = await loadBackground({ settings: { enabled: true, recordBodies: true, bufferMs: 300_000 } });
  await tick();
  bg.chrome.webRequest.onBeforeRequest.fire({
    requestId: 'form',
    tabId: 1,
    url: 'https://a.example/upload',
    method: 'POST',
    type: 'main_frame',
    timeStamp: Date.now(),
    requestBody: { formData: { note: ['x'.repeat(1_000_000)] } },
  });
  await tick(1_100);
  const stored = bg.session.data['net:1'] as any[];
  assert.equal(stored[0].requestBody, '[body omitted: truncated]');
});

test('error stack is redacted like the message', () => {
  const bundle = buildBundle({
    page,
    entries: [{ kind: 'error', time: 1, message: 'x', stack: 'Error: login failed {"password":"HUNTER2"} Bearer abcdefghijkl\n    at f (https://a.example/app.js?token=T:1:1)', unhandledRejection: false, url: page.url }],
    network: [],
    policy: DEFAULT_POLICY,
    extensionVersion: '0',
    now: 0,
  });
  assert.doesNotMatch(JSON.stringify(bundle.console), /HUNTER2|abcdefghijkl|token=T/);
});

test('console serializer hides sensitive keys with object values and nested JSON strings', () => {
  const objectValue = serializeArg({ token: { access: 'ACC123', refresh: 'REF456' }, tokens: ['ACC789'], user: 'jan' });
  assert.doesNotMatch(objectValue, /ACC123|REF456|ACC789/);
  assert.match(objectValue, /"user": "jan"/);
  const nested = serializeArg({ data: JSON.stringify({ password: 'SECRET1', id: 7 }) });
  assert.doesNotMatch(nested, /SECRET1/);
  assert.match(nested, /"id": 7/);
  // Řetězec na nejvyšší úrovni projde až redakcí textu.
  assert.doesNotMatch(redactSecretsInText(JSON.stringify({ token: { access: 'ACC123' }, list: { tokens: ['X1'] } }), DEFAULT_POLICY), /ACC123|X1/);
});

test('URL redaction in text stays linear on hostile input', () => {
  const start = performance.now();
  redactSecretsInText('a.'.repeat(50_000), DEFAULT_POLICY);
  assert.ok(performance.now() - start < 200, 'redaction took too long');
  assert.doesNotMatch(redactSecretsInText('...https://a.example/?token=SECRET -http://b.example/?token=SECRET2', DEFAULT_POLICY), /SECRET/);
});

test('element names are dropped together with element texts', () => {
  const bundle = buildBundle({
    page,
    entries: [],
    elements: [{ selector: '#a', tag: 'button', name: 'Smazat účet jan@example.com', text: 'Smazat', rect: { x: 0, y: 0, width: 1, height: 1 }, depth: 1 }],
    network: [],
    policy: { ...DEFAULT_POLICY, includeElementText: false },
    extensionVersion: '0',
    now: 0,
  });
  assert.equal(bundle.elements?.[0].name, undefined);
  assert.equal(bundle.elements?.[0].text, undefined);
});

test('quoted Refresh URLs are redacted', async () => {
  const { redactHeaders } = await import('../src/lib/redact.ts');
  const [header] = redactHeaders([{ name: 'Refresh', value: '0; url="https://user:SECRET@a.example/x?token=T"' }], DEFAULT_POLICY);
  assert.doesNotMatch(header.value, /SECRET|token=T/);
  assert.match(header.value, /^0; url="https:\/\//);
  for (const value of [
    "0; url=https://a.example/o'neil?token=SECRET",
    `0; url="https://a.example/o'neil?token=SECRET"`,
    "0; url='https://a.example/x?token=SECRET'",
    '0; url="https://user:SECRET@a.example/x',
    '0; url="https://user:SECRET@a.example/x"; extra',
  ]) {
    assert.doesNotMatch(redactHeaders([{ name: 'Refresh', value }], DEFAULT_POLICY)[0].value, /SECRET/);
  }
});

test('summary counts requests seen only by the page recorder', () => {
  const bundle = buildBundle({
    page,
    entries: [{ kind: 'request', time: 1, api: 'fetch', method: 'GET', url: 'https://a.example/sw-only', status: 200 }],
    network: [],
    policy: DEFAULT_POLICY,
    extensionVersion: '0',
    now: 0,
  });
  assert.equal(bundle.summary.requestCount, 1);
});

test('ring buffer drops entries older than the window on push', () => {
  const buffer = new RingBuffer<{ time: number }>(10, 1_000);
  buffer.push({ time: 1_000 });
  buffer.push({ time: 5_000 });
  assert.deepEqual(buffer.toArray(), [{ time: 5_000 }]);
});

test('incognito windows are never captured', async () => {
  const bg = await loadBackground({
    settings: { enabled: true, recordBodies: false, bufferMs: 300_000 },
    windows: [{ id: 1, focused: true, incognito: true, left: 0, top: 0, width: 1200, height: 800, tabs: [{ id: 1, windowId: 1, active: true, url: 'https://a.example/', title: 'A' }] } as any],
    collect: () => ({ page: { ...page }, entries: [] }),
  });
  await tick();
  const reply = await bg.request({ type: 'capture.request', id: 'inc' });
  assert.equal(reply.type, 'capture.error');
});
