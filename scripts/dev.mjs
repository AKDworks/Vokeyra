import { build } from 'esbuild';
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';
import { common, entries } from './build.mjs';
import { buildNative } from './build-native.mjs';
await buildNative();
await Promise.all(entries.map(entry => build({ ...common, ...entry })));
const server = await createServer();
await server.listen();
const env = { ...process.env, VOKEYRA_DEV_URL: 'http://127.0.0.1:5173' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { stdio: 'inherit', env, windowsHide: false });
let closing = false;
async function close(code = 0) {
  if (closing) return;
  closing = true;
  child.kill();
  await server.close();
  process.exit(code);
}
child.on('exit', code => void close(code ?? 0));
child.on('error', error => { console.error(error); void close(1); });
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
console.log('Renderer: HMR включён. После изменения main/preload перезапустите npm run dev.');
