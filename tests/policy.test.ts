import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_POLICY, normalizePolicy } from '../src/lib/defaults.ts';
import { REDACTED } from '../src/lib/redact.ts';
import { loadBackground } from './fake-chrome.ts';

const hostile = {
  redactCookies: false,
  redactAuthHeaders: false,
  redactHeaders: [],
  redactQueryParams: [],
  redactBodyKeys: [],
  includeBodies: true,
  windowMs: 600_000,
};

test('host policy can only add redaction', () => {
  const policy = normalizePolicy(hostile as any, { enabled: true, recordBodies: false, bufferMs: 300_000 });
  assert.equal(policy.redactCookies, true);
  assert.equal(policy.redactAuthHeaders, true);
  assert.equal(policy.includeBodies, false);
  for (const name of DEFAULT_POLICY.redactQueryParams) assert.ok(policy.redactQueryParams.includes(name), name);
  for (const name of DEFAULT_POLICY.redactBodyKeys) assert.ok(policy.redactBodyKeys.includes(name), name);

  const merged = normalizePolicy({ redactQueryParams: ['tenant'], redactHeaders: ['X-Tenant'], includeBodies: true }, { enabled: true, recordBodies: true, bufferMs: 300_000 });
  assert.ok(merged.redactQueryParams.includes('tenant'));
  assert.ok(merged.redactQueryParams.includes('access_token'));
  assert.deepEqual(merged.redactHeaders, ['X-Tenant']);
  assert.equal(merged.includeBodies, true);
});

test('policy fields with wrong types are ignored', () => {
  const policy = normalizePolicy(
    { includeConsole: 'no', includeNetwork: 0, redactQueryParams: 'token', redactBodyKeys: [1, 'pin'], redactHeaders: { a: 1 }, windowMs: '5', maxBodyBytes: null } as any,
    { enabled: true, recordBodies: false, bufferMs: 300_000 },
  );
  assert.equal(policy.includeConsole, true);
  assert.equal(policy.includeNetwork, true);
  assert.deepEqual(policy.redactQueryParams, DEFAULT_POLICY.redactQueryParams);
  assert.deepEqual(policy.redactBodyKeys, [...DEFAULT_POLICY.redactBodyKeys, 'pin']);
  assert.deepEqual(policy.redactHeaders, []);
  assert.equal(policy.windowMs, DEFAULT_POLICY.windowMs);
  assert.equal(policy.maxBodyBytes, DEFAULT_POLICY.maxBodyBytes);
  assert.deepEqual(normalizePolicy('garbage' as any, { enabled: true, recordBodies: false, bufferMs: 1 }), DEFAULT_POLICY);
});

test('capture.request cannot switch off cookie redaction or read inactive tabs', async () => {
  const bg = await loadBackground({
    settings: { enabled: true, recordBodies: false, bufferMs: 300_000 },
    windows: [
      {
        id: 1, focused: true, left: 0, top: 0, width: 1200, height: 800,
        tabs: [
          { id: 1, windowId: 1, active: true, url: 'https://app.example.com/', title: 'App' },
          { id: 2, windowId: 1, active: false, url: 'https://bank.example.com/', title: 'Bank' },
        ],
      },
      { id: 2, focused: false, left: 50, top: 50, width: 900, height: 700, tabs: [{ id: 3, windowId: 2, active: true, url: 'https://other.example.com/', title: 'Other' }] },
    ],
  });
  const now = Date.now();
  for (const tabId of [1, 2]) {
    bg.chrome.webRequest.onBeforeRequest.fire({ requestId: `r${tabId}`, tabId, url: `https://api.example.com/${tabId}`, method: 'GET', type: 'xmlhttprequest', timeStamp: now });
    bg.chrome.webRequest.onBeforeSendHeaders.fire({ requestId: `r${tabId}`, tabId, requestHeaders: [{ name: 'Cookie', value: 'sid=secret' }, { name: 'Authorization', value: 'Bearer secret' }] });
  }

  const reply = await bg.request({ type: 'capture.request', id: '1', target: { tabId: 2 }, policy: hostile });
  assert.equal(reply.type, 'capture.result');
  assert.equal(reply.bundle.page.url, 'https://app.example.com/');
  const entries = reply.bundle.har.log.entries;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].request.url, 'https://api.example.com/1');
  const headers = Object.fromEntries(entries[0].request.headers.map((header: any) => [header.name, header.value]));
  assert.equal(headers.Cookie, `sid=${REDACTED}`);
  assert.equal(headers.Authorization, `Bearer ${REDACTED}`);
  assert.equal(reply.bundle.policy.redactCookies, true);
  assert.equal(reply.bundle.policy.includeBodies, false);

  // The active tab of an unfocused window can be picked by tabId.
  const active = await bg.request({ type: 'capture.request', id: '2', target: { tabId: 3 } });
  assert.equal(active.bundle.page.url, 'https://other.example.com/');

  const badType = await bg.request({ type: 'capture.request', id: '3', target: { tabId: '3', windowTitle: 'Other' } });
  assert.equal(badType.bundle.page.url, 'https://app.example.com/');
});
