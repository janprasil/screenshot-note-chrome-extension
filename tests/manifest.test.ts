import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../src/manifest.json', import.meta.url), 'utf8'));

test('extension cannot be enabled in incognito windows', () => {
  assert.equal(manifest.incognito, 'not_allowed');
});

test('permissions stay limited to what capture needs', () => {
  assert.deepEqual([...manifest.permissions].sort(), ['nativeMessaging', 'scripting', 'storage', 'webRequest']);
  assert.equal(manifest.externally_connectable, undefined);
  assert.equal(manifest.web_accessible_resources, undefined);
});
