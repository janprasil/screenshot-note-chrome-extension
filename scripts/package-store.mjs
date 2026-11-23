// Packs dist/ for the Chrome Web Store without the `key` field, which the Store rejects.
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
delete manifest.key;
const out = resolve(`screenshot-note-context-${manifest.version}.zip`);
const staging = resolve('dist-store');
await rm(staging, { recursive: true, force: true });
await mkdir(staging);
try {
  await cp('dist', staging, { recursive: true });
  await writeFile(`${staging}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  await rm(out, { force: true });
  execFileSync('zip', ['-qr', out, '.'], { cwd: staging });
  console.log(`Store package: ${out}`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
