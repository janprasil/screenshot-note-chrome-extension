// Development stand-in for the Mac app bridge. Chrome starts it, `kill -USR1 <pid>` asks for a capture.
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const outDir = process.env.SN_DEV_OUT ?? join(homedir(), 'Downloads', 'screenshot-note-dev');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'host.pid'), String(process.pid));

let pending = Buffer.alloc(0);
let counter = 0;

function send(message) {
  const body = Buffer.from(JSON.stringify(message));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  process.stdout.write(Buffer.concat([header, body]));
}

function log(line) {
  writeFileSync(join(outDir, 'host.log'), `${new Date().toISOString()} ${line}\n`, { flag: 'a' });
}

process.stdin.on('data', (chunk) => {
  pending = Buffer.concat([pending, chunk]);
  while (pending.length >= 4) {
    const length = pending.readUInt32LE(0);
    if (pending.length < 4 + length) break;
    const message = JSON.parse(pending.subarray(4, 4 + length).toString('utf8'));
    pending = pending.subarray(4 + length);
    handle(message);
  }
});
process.stdin.on('end', () => process.exit(0));

function handle(message) {
  log(`<- ${message.type}${message.id ? ` ${message.id}` : ''}`);
  if (message.type === 'hello') send({ type: 'hello', protocol: 1, app: { version: 'dev-host', running: true } });
  if (message.type === 'capture.result') {
    const base = join(outDir, `capture-${message.id}`);
    writeFileSync(`${base}.json`, JSON.stringify(message.bundle, null, 2));
    if (message.bundle.har) writeFileSync(`${base}.har`, JSON.stringify(message.bundle.har, null, 2));
    log(`saved ${base}.json`);
  }
  if (message.type === 'capture.error') log(`error ${message.code}: ${message.message}`);
}

process.on('SIGUSR1', () => {
  const id = `${Date.now()}-${++counter}`;
  log(`-> capture.request ${id}`);
  send({ type: 'capture.request', id, policy: { includeBodies: process.env.SN_BODIES === '1' } });
});
