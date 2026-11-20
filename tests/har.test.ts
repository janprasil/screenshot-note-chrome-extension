import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_POLICY } from '../src/lib/defaults.ts';
import { buildHar } from '../src/lib/har.ts';
import { REDACTED } from '../src/lib/redact.ts';
import type { NetworkEntry, PageRequestEntry } from '../src/lib/types.ts';

const network: NetworkEntry[] = [
  {
    requestId: '1', tabId: 1, url: 'https://api.example.com/users?token=abc', method: 'POST', type: 'xmlhttprequest',
    startTime: 1_000, endTime: 1_250, statusCode: 500, statusLine: 'HTTP/1.1 500 Internal Server Error',
    requestHeaders: [{ name: 'Cookie', value: 'sid=1' }, { name: 'Content-Type', value: 'application/json' }],
    responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Set-Cookie', value: 'sid=2; Path=/' }],
  },
];
const page: PageRequestEntry[] = [
  { kind: 'request', time: 1_010, api: 'fetch', method: 'POST', url: 'https://api.example.com/users?token=abc', status: 500, requestBody: '{"password":"x","name":"a"}', responseBody: '{"error":"boom"}' },
  { kind: 'request', time: 2_000, api: 'fetch', method: 'GET', url: 'https://sw.example.com/cached', status: 200 },
];

test('HAR merges page bodies into webRequest entries and redacts', () => {
  const har = buildHar({ network, pageRequests: page, pageUrl: 'https://example.com', pageTitle: 'T', extensionVersion: '0.1.0', policy: { ...DEFAULT_POLICY, includeBodies: true } }) as any;
  assert.equal(har.log.version, '1.2');
  assert.equal(har.log.entries.length, 2);
  const [entry, pageOnly] = har.log.entries;
  assert.equal(entry.time, 250);
  assert.equal(entry.response.status, 500);
  assert.equal(entry.response.statusText, 'Internal Server Error');
  assert.equal(entry.request.httpVersion, 'HTTP/1.1');
  assert.match(entry.request.url, /token=%5Bredacted%5D/);
  assert.deepEqual(entry.request.cookies, [{ name: 'sid', value: REDACTED }]);
  assert.deepEqual(entry.response.cookies, [{ name: 'sid', value: REDACTED }]);
  assert.equal(entry.request.postData.text, `{"password":"${REDACTED}","name":"a"}`);
  assert.equal(entry.response.content.text, '{"error":"boom"}');
  assert.equal(pageOnly._source, 'page');
});

test('HAR omits bodies when the policy says so', () => {
  const har = buildHar({ network, pageRequests: page, pageUrl: 'https://example.com', pageTitle: 'T', extensionVersion: '0.1.0', policy: DEFAULT_POLICY }) as any;
  assert.equal(har.log.entries[0].request.postData, undefined);
  assert.equal(har.log.entries[0].response.content.text, undefined);
});
