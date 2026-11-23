// Bundles the extension into dist/ ready for "Load unpacked".
import { build, context } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
const out = 'dist';

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const common = { bundle: true, target: 'chrome116', sourcemap: watch ? 'inline' : false, logLevel: 'info' };
const configs = [
  { ...common, entryPoints: ['src/background.ts'], outfile: `${out}/background.js`, format: 'esm' },
  { ...common, entryPoints: ['src/popup/popup.ts'], outfile: `${out}/popup.js`, format: 'esm' },
  // Content scripts cannot be ES modules.
  { ...common, entryPoints: ['src/inject.ts'], outfile: `${out}/inject.js`, format: 'iife' },
  { ...common, entryPoints: ['src/content.ts'], outfile: `${out}/content.js`, format: 'iife' },
];

await cp('src/manifest.json', `${out}/manifest.json`);
await cp('src/_locales', `${out}/_locales`, { recursive: true });
await cp('src/icons', `${out}/icons`, { recursive: true });
await cp('src/popup/popup.html', `${out}/popup.html`);
await cp('src/popup/popup.css', `${out}/popup.css`);

if (watch) {
  for (const config of configs) await (await context(config)).watch();
} else {
  await Promise.all(configs.map((config) => build(config)));
}
