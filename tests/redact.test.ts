import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_POLICY } from '../src/lib/defaults.ts';
import { REDACTED, redactBody, redactCookieHeader, redactHeaders, redactSetCookieHeader, redactUrl, truncate } from '../src/lib/redact.ts';

test('cookie values are hidden, names stay', () => {
  assert.equal(redactCookieHeader('sid=abc; theme=dark'), `sid=${REDACTED}; theme=${REDACTED}`);
  assert.equal(redactSetCookieHeader('sid=abc; Path=/; HttpOnly'), `sid=${REDACTED}; Path=/; HttpOnly`);
});

test('headers follow the policy switches', () => {
  const headers = [
    { name: 'Cookie', value: 'a=1' },
    { name: 'Authorization', value: 'Bearer eyJ.secret' },
    { name: 'X-Tenant', value: 'acme' },
    { name: 'Accept', value: 'application/json' },
  ];
  const redacted = redactHeaders(headers, { ...DEFAULT_POLICY, redactHeaders: ['x-tenant'] });
  assert.deepEqual(redacted.map((header) => header.value), [`a=${REDACTED}`, `Bearer ${REDACTED}`, REDACTED, 'application/json']);

  const raw = redactHeaders(headers, { ...DEFAULT_POLICY, redactCookies: false, redactAuthHeaders: false });
  assert.deepEqual(raw.map((header) => header.value), ['a=1', 'Bearer eyJ.secret', 'acme', 'application/json']);
});

test('sensitive query params and credentials in URL are hidden', () => {
  const url = redactUrl('https://user:pw@example.com/cb?code=123&page=2&Token=x', DEFAULT_POLICY);
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('code'), REDACTED);
  assert.equal(parsed.searchParams.get('Token'), REDACTED);
  assert.equal(parsed.searchParams.get('page'), '2');
  assert.equal(decodeURIComponent(parsed.username), REDACTED);
  assert.equal(redactUrl('https://example.com/a?b=1', DEFAULT_POLICY), 'https://example.com/a?b=1');
});

test('bodies are dropped unless enabled, then keys are redacted', () => {
  assert.equal(redactBody('{"password":"x"}', DEFAULT_POLICY).text, undefined);
  const policy = { ...DEFAULT_POLICY, includeBodies: true };
  assert.equal(redactBody('{"user":"jan","nested":{"Password":"x"}}', policy).text, `{"user":"jan","nested":{"Password":"${REDACTED}"}}`);
  assert.equal(redactBody('user=jan&password=x', policy).text, `user=jan&password=${encodeURIComponent(REDACTED)}`);
  assert.equal(redactBody('plain text', policy).text, '[body omitted: unparsed]');
});

test('truncate respects UTF-8 byte limit', () => {
  const result = truncate('ěěěě', 5);
  assert.equal(result.truncated, true);
  assert.equal(result.text, 'ěě');
});
