import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

if (process.platform !== 'win32') throw new Error('This integration check requires Windows.');
await mkdir('.tmp', { recursive: true });
await new Promise((done, reject) => {
  const compiler = spawn(join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), ['/nologo', '/out:' + resolve('.tmp/NativeKeySender.exe'), resolve('tests/NativeKeySender.cs')], { windowsHide: true, stdio: 'inherit' });
  compiler.on('error', reject); compiler.on('exit', code => code === 0 ? done() : reject(new Error('Key sender compilation failed')));
});
function helper() {
  const processHandle = spawn(resolve('src-tauri/target/debug/vokeyra.exe'), ['--desktop-worker', String(process.pid)], { windowsHide: true, stdio: 'pipe' });
  let id = 0;
  const pending = new Map();
  let release;
  createInterface({ input: processHandle.stdout }).on('line', line => {
    const [key, status, value] = line.split('\t');
    if (key === '0') return release?.();
    const item = pending.get(key); if (!item) return;
    pending.delete(key); clearTimeout(item.timer);
    if (status === 'ok') item.resolve(value); else item.reject(new Error(Buffer.from(value, 'base64').toString()));
  });
  processHandle.stderr.on('data', data => console.error(String(data)));
  return {
    command(command, args = '') {
      return new Promise((resolve, reject) => {
        const key = String(++id);
        const timer = setTimeout(() => reject(new Error(`Helper timeout: ${command}`)), 5000);
        pending.set(key, { resolve, reject, timer });
        processHandle.stdin.write(`${key}\t${command}\t${args}\n`);
      });
    },
    released(callback) { release = callback; },
    async close() {
      processHandle.stdin.end();
      await new Promise(resolve => { processHandle.once('exit', resolve); if (processHandle.exitCode !== null) resolve(); });
    },
  };
}
const worker = helper();
try {
  await worker.command('ping');
  const before = await worker.command('audio-state');
  await worker.command('mute');
  assert.ok((await worker.command('audio-state')).split(',').every(value => value === '1' || value === ''));
  await worker.command('restore');
  assert.equal(await worker.command('audio-state'), before, 'Restore exact pre-recording mute states');
  const sender = spawn(resolve('.tmp/NativeKeySender.exe'), ['135', '450'], { windowsHide: true });
  await new Promise(resolve => sender.stdout.once('data', resolve));
  let released = false;
  const event = new Promise(resolve => worker.released(() => { released = true; resolve(); }));
  await worker.command('watch', '135');
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(released, false, 'Hold remains active after repeated down');
  await Promise.race([event, new Promise((_, reject) => setTimeout(() => reject(new Error('Release not observed')), 2500))]);
  await worker.command('mute');
  await worker.close();
  const observer = helper();
  try { assert.equal(await observer.command('audio-state'), before, 'EOF restores sound even without an explicit restore command'); }
  finally { await observer.close(); }
  console.log('Windows native checks passed: key down/repeat/up, mute, exact restore, restore on pipe closure.');
} finally { await worker.close(); }
