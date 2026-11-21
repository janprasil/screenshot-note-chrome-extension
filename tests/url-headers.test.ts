import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_POLICY } from '../src/lib/defaults.ts';
import { buildHar } from '../src/lib/har.ts';
import { REDACTED, redactHeaders, redactUrl } from '../src/lib/redact.ts';

test('URL-carrying headers and redirectURL are redacted', () => {
  const headers = redactHeaders(
    [
      { name: 'Referer', value: 'https://a.example/?token=SECRET&page=2' },
      { name: 'Location', value: 'https://a.example/cb?code=SECRET&state=S' },
      { name: 'Origin', value: 'null' },
      { name: 'Content-Location', value: '/cb?access_token=SECRET' },
    ],
    DEFAULT_POLICY,
  );
  for (const header of headers) assert.doesNotMatch(header.value, /SECRET|\bS\b/, header.name);
  assert.equal(headers[2].value, 'null');
  assert.match(headers[0].value, /page=2/);
  assert.equal(headers[3].value, `/cb?access_token=${encodeURIComponent(REDACTED)}`);

  const har = buildHar({
    network: [{ requestId: '1', tabId: 1, url: 'https://a.example/login', method: 'POST', type: 'main_frame', startTime: 1, statusCode: 302, responseHeaders: [{ name: 'Location', value: '/cb?code=SECRET&state=S' }] }],
    pageRequests: [],
    pageUrl: 'https://a.example/',
    pageTitle: 'T',
    extensionVersion: '0',
    policy: DEFAULT_POLICY,
  }) as any;
  assert.doesNotMatch(har.log.entries[0].response.redirectURL, /SECRET/);
  assert.match(har.log.entries[0].response.redirectURL, /^\/cb\?code=/);
});

test('sensitive parameters in URL fragments are redacted', () => {
  const implicit = redactUrl('https://app.example/cb#access_token=SECRET&id_token=X&expires_in=3600', DEFAULT_POLICY);
  assert.doesNotMatch(implicit, /SECRET|id_token=X/);
  assert.match(implicit, /expires_in=3600/);
  const spa = redactUrl('https://app.example/#/reset?token=SECRET&tab=1', DEFAULT_POLICY);
  assert.doesNotMatch(spa, /SECRET/);
  assert.match(spa, /#\/reset\?token=.*&tab=1$/);
  assert.equal(redactUrl('https://app.example/#section-2', DEFAULT_POLICY), 'https://app.example/#section-2');
});

test('URL redaction edge cases', () => {
  const once = (url: string) => redactUrl(url, DEFAULT_POLICY);
  assert.doesNotMatch(once('https://a.example/?acc%65ss_token=SECRET'), /SECRET/);
  assert.doesNotMatch(once('https://a.example/p#a#token=SECRET'), /SECRET/);
  assert.doesNotMatch(once('//u:SECRET@a.example/x'), /SECRET/);
  assert.equal(once('/cb'), '/cb');
  assert.equal(once('https://a.example/x?q=a%20b+c#top'), 'https://a.example/x?q=a%20b+c#top');
  const redacted = once('https://u:p@a.example/cb?code=1#access_token=2');
  assert.equal(once(redacted), redacted);
  assert.equal(once('http://[bad/?token=SECRET'), `http://[bad/?token=${encodeURIComponent(REDACTED)}`);
  const refresh = redactHeaders([{ name: 'Refresh', value: '0; url=https://a.example/?token=SECRET' }], DEFAULT_POLICY);
  assert.doesNotMatch(refresh[0].value, /SECRET/);
});

test('URLs inside stack traces and error messages are redacted', async () => {
  const { buildBundle } = await import('../src/lib/capture.ts');
  const bundle = buildBundle({
    page: { url: 'https://a.example/', title: 'T', userAgent: 'u', language: 'cs', geometry: { screenX: 0, screenY: 0, outerWidth: 1, outerHeight: 1, innerWidth: 1, innerHeight: 1, devicePixelRatio: 1, scrollX: 0, scrollY: 0 } },
    entries: [
      { kind: 'error', time: 1, message: 'Failed https://cdn.example/app.js?sig=SECRET', stack: 'at f (https://cdn.example/app.js?sig=SECRET:1:2)', unhandledRejection: false, url: 'https://a.example/#token=SECRET' },
      { kind: 'console', time: 2, level: 'error', args: ['x'], stack: 'at g (https://a.example/#/r?token=SECRET:3:4)', url: 'https://a.example/' },
    ],
    network: [],
    policy: DEFAULT_POLICY,
    extensionVersion: '0',
  });
  assert.doesNotMatch(JSON.stringify(bundle.console), /SECRET/);
});
