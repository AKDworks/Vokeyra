import { spawn } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { collectUpdatePlatforms } from './update-manifest.mjs';

const keyPath = resolve('.signing/tauri-update.key');
const unsigned = process.argv.includes('--unsigned');
const args = ['node_modules/@tauri-apps/cli/tauri.js', 'build', ...process.argv.slice(2).filter(arg => arg !== '--unsigned')];
const env = { ...process.env };
if (!env.CARGO_HOME && await stat('.tmp/cargo-home/registry').then(item => item.isDirectory()).catch(() => false)) {
  env.CARGO_HOME = resolve('.tmp/cargo-home');
}
// Release signing keys are local, ignored, and never bundled with the app.
if (!unsigned && !env.TAURI_SIGNING_PRIVATE_KEY && await stat(keyPath).then(file => file.isFile()).catch(() => false)) {
  env.TAURI_SIGNING_PRIVATE_KEY = await readFile(keyPath, 'utf8');
  env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= '';
}
if (unsigned) delete env.TAURI_SIGNING_PRIVATE_KEY;
if (!unsigned && !args.includes('--no-bundle') && !env.TAURI_SIGNING_PRIVATE_KEY) {
  throw new Error('Updater signing key is missing. Restore .signing/tauri-update.key or set TAURI_SIGNING_PRIVATE_KEY.');
}
args.push('--config', JSON.stringify({ bundle: { createUpdaterArtifacts: !!env.TAURI_SIGNING_PRIVATE_KEY && !args.includes('--no-bundle') } }));
const code = await new Promise((resolveRun, reject) => {
  const child = spawn(process.execPath, args, { stdio: 'inherit', env });
  child.once('error', reject); child.once('exit', resolveRun);
});
process.exitCode = code ?? 1;
if (code === 0 && env.TAURI_SIGNING_PRIVATE_KEY && !args.includes('--no-bundle')) {
  const { version } = JSON.parse(await readFile('package.json', 'utf8'));
  const root = resolve('src-tauri/target/release/bundle');
  const platforms = await collectUpdatePlatforms(root, version, process.platform, process.arch);
  const manifest = { version, notes: '', pub_date: new Date().toISOString(), platforms };
  const json = JSON.stringify(manifest, null, 2) + '\n';
  await writeFile(join(root, `latest-${process.platform}-${process.arch}.json`), json);
  if (process.platform === 'win32') await writeFile(join(root, 'nsis/latest.json'), json);
}
