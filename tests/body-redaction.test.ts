import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_POLICY } from '../src/lib/defaults.ts';
import { buildHar } from '../src/lib/har.ts';
import { REDACTED, redactBody } from '../src/lib/redact.ts';
import { loadBackground } from './fake-chrome.ts';

const policy = { ...DEFAULT_POLICY, includeBodies: true };

test('truncated or unparsable bodies are replaced by a placeholder', () => {
  assert.match(redactBody('{"password":"SECRET","pad":"xxxx', policy).text!, /^\[body omitted/);
  assert.match(redactBody('{"password":"SECRET"}', policy, true).text!, /^\[body omitted/);
  assert.match(redactBody('password: SECRET', policy).text!, /^\[body omitted/);
  assert.match(redactBody('<login><password>SECRET</password></login>', policy).text!, /^\[body omitted/);
  assert.equal(redactBody('[binary body]', policy).text, '[binary body]');

  const har = buildHar({
    network: [],
    pageRequests: [{ kind: 'request', time: 1, api: 'fetch', method: 'GET', url: 'https://a.example/x', status: 200, responseBody: '{"access_token":"SECRET","data":"', truncated: true }],
    pageUrl: 'https://a.example/', pageTitle: 'T', extensionVersion: '0', policy,
  }) as any;
  assert.doesNotMatch(JSON.stringify(har), /SECRET/);
});

test('multipart bodies are redacted field by field', () => {
  const body = '--b\r\nContent-Disposition: form-data; name="user"\r\n\r\njan\r\n--b\r\nContent-Disposition: form-data; name="password"\r\n\r\nSECRET\r\n--b\r\nContent-Disposition: form-data; name="avatar"; filename="a.png"\r\nContent-Type: image/png\r\n\r\nPNGDATA\r\n--b--\r\n';
  const text = redactBody(body, policy).text!;
  assert.doesNotMatch(text, /SECRET|PNGDATA/);
  assert.match(text, /name="user"\r\n\r\njan\r\n/);
  assert.match(text, new RegExp(`name="password"\\r\\n\\r\\n${REDACTED.replace(/[[\]]/g, '\\$&')}\\r\\n`));
});

test('sensitive body keys match by case-insensitive substring', () => {
  const json = redactBody('{"user":{"new_password":"S1","Client_Secret":"S2","pwd":"S3","otpCode":"S4","card[number]":"S5","name":"jan"}}', policy).text!;
  assert.doesNotMatch(json, /S\d/);
  assert.match(json, /"name":"jan"/);
  const form = redactBody('remember&user%5Bpassword%5D=S1&sessionId=S2&name=jan', policy, false, 'application/x-www-form-urlencoded').text!;
  assert.doesNotMatch(form, /S\d/);
  assert.match(form, /^remember&/);
  assert.match(form, /name=jan/);
});

test('webRequest bodies over the size limit are not sent half-parsed', async () => {
  const bg = await loadBackground({ settings: { enabled: true, recordBodies: true, bufferMs: 300_000 } });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const json = JSON.stringify({ password: 'SECRET', pad: 'x'.repeat(100 * 1024) });
  bg.chrome.webRequest.onBeforeRequest.fire({
    requestId: 'big', tabId: 1, url: 'https://api.example.com/login', method: 'POST', type: 'xmlhttprequest', timeStamp: Date.now(),
    requestBody: { raw: [{ bytes: new TextEncoder().encode(json).buffer }] },
  });
  const reply = await bg.request({ type: 'capture.request', id: '1', policy: { includeBodies: true } });
  const text = reply.bundle.har.log.entries[0].request.postData?.text ?? '';
  assert.doesNotMatch(text, /SECRET/);
});

test('raw tokens are not mistaken for forms', () => {
  for (const body of ['c2VjcmV0dG9rZW52YWx1ZQ==', 'SECRETTOKEN123&x=1', '"abc=SECRET"', 'a=1;password=SECRET', 'remember&password=SECRET']) {
    assert.doesNotMatch(redactBody(body, policy).text!, /SECRET|c2Vj/, body);
  }
});

test('structured data nested in values is redacted', () => {
  const nestedJson = redactBody(JSON.stringify({ data: JSON.stringify({ password: 'SECRET' }), fields: [{ name: 'password', value: 'SECRET' }] }), policy).text!;
  assert.doesNotMatch(nestedJson, /SECRET/);
  const form = redactBody(`payload=${encodeURIComponent('{"password":"SECRET"}')}&a=1`, policy).text!;
  assert.doesNotMatch(decodeURIComponent(form), /SECRET/);
  const multipart = '--b\r\nContent-Disposition: form-data; name="operations"\r\nContent-Type: application/json\r\n\r\n{"variables":{"password":"SECRET"}}\r\n--b--\r\n';
  assert.doesNotMatch(redactBody(multipart, policy).text!, /SECRET/);
});

test('multipart parsing does not leak through boundaries, epilogues or odd names', () => {
  const bodies = [
    '--b\r\nContent-Disposition: form-data; name="password"\r\n\r\nx--b--SECRET\r\n--b--\r\n',
    '--b\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n--b--\r\nSECRET epilogue',
    '--b\r\nContent-Disposition: form-data; x-name="u"; name="password"\r\n\r\nSECRET\r\n--b--\r\n',
    '--b\r\nContent-Disposition: form-data; name="a"\r\n\r\nSECRET',
  ];
  for (const body of bodies) assert.doesNotMatch(redactBody(body, policy).text!, /SECRET/, JSON.stringify(body));
});
