import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const env = { ...process.env };
// Reuse the cache prepared for this workspace; a fresh checkout uses Cargo's
// normal cache unless CARGO_HOME is explicitly configured by its developer.
if (!env.CARGO_HOME && await stat('.tmp/cargo-home/registry').then(item => item.isDirectory()).catch(() => false)) {
  env.CARGO_HOME = resolve('.tmp/cargo-home');
}
const child = spawn(process.execPath, ['node_modules/@tauri-apps/cli/tauri.js', ...process.argv.slice(2)], { env, stdio: 'inherit' });
child.once('error', error => { console.error(error); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });
