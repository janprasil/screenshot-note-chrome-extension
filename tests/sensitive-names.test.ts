import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_POLICY } from '../src/lib/defaults.ts';
import { REDACTED, redactHeaders, redactUrl } from '../src/lib/redact.ts';

test('header names are matched by sensitive pattern, not only the exact list', () => {
  const names = ['Cf-Access-Jwt-Assertion', 'DPoP', 'X-Ms-Client-Principal', 'PRIVATE-TOKEN', 'X-Amz-Security-Token', 'Ocp-Apim-Subscription-Key', 'api-key', 'X-CSRFToken', 'X-Session-Id', 'X-Signature', 'X-Goog-Credential', 'X-Password'];
  const redacted = redactHeaders(names.map((name) => ({ name, value: 'SECRET' })), DEFAULT_POLICY);
  for (const header of redacted) assert.equal(header.value, REDACTED, header.name);

  const kept = redactHeaders(
    [
      { name: 'Accept', value: 'application/json' },
      { name: 'Keep-Alive', value: 'timeout=5' },
      { name: 'Access-Control-Allow-Credentials', value: 'true' },
      { name: 'WWW-Authenticate', value: 'Bearer error="invalid_token"' },
    ],
    DEFAULT_POLICY,
  );
  assert.deepEqual(kept.map((header) => header.value), ['application/json', 'timeout=5', 'true', 'Bearer error="invalid_token"']);

  const [scheme, location] = redactHeaders(
    [{ name: 'X-Session', value: 'Bearer abc' }, { name: 'Location', value: '/f?X-Amz-Signature=SECRET' }],
    DEFAULT_POLICY,
  );
  assert.equal(scheme.value, `Bearer ${REDACTED}`);
  assert.doesNotMatch(location.value, /SECRET/);
});

test('query parameter names are matched by sensitive pattern', () => {
  const url = redactUrl(
    'https://bucket.storage.example/f?X-Amz-Algorithm=HMAC&X-Amz-Credential=S1&X-Amz-Security-Token=S2&X-Amz-Signature=S3&auth=S4&sessionid=S5&client_secret=S6&jwt=S7&page=2',
    DEFAULT_POLICY,
  );
  assert.doesNotMatch(url, /S\d/);
  assert.match(url, /X-Amz-Algorithm=HMAC/);
  assert.match(url, /page=2/);
  assert.doesNotMatch(redactUrl('https://a.example/#/cb?refreshToken=S1', DEFAULT_POLICY), /S1/);
  assert.doesNotMatch(redactUrl('https://a.example/?%74oken=S1&PHPSESSID=S2&pwd=S3&ticket=S4', DEFAULT_POLICY), /S\d/);
});
