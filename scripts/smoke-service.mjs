import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

const resourcePath = resolve(process.platform === 'linux' ? 'dist/desktop-linux' : 'dist/desktop');
const { version } = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
const dataPath = await mkdtemp(resolve('.tmp/tauri-service-'));
const config = { dataPath, resourcePath, executablePath: resolve('src-tauri/target/debug/vokeyra.exe'), version, packaged: false, hidden: false };
const child = spawn(join(resourcePath, process.platform === 'win32' ? 'node.exe' : 'node'), [join(resourcePath, 'service.cjs')], {
  env: { ...process.env, VOKEYRA_HOST_CONFIG: JSON.stringify(config) }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
});
let diagnostics = '', id = 0, clipboard = '';
const pending = new Map();
child.stderr.on('data', data => { diagnostics += data; });
const send = message => child.stdin.write(JSON.stringify(message) + '\n');
createInterface({ input: child.stdout }).on('line', line => {
  const message = JSON.parse(line);
  if (message.hostId) {
    let result = null;
    if (message.method === 'shortcut:register' || message.method === 'window:focused') result = true;
    if (message.method === 'clipboard:write') clipboard = message.args[0];
    if (message.method === 'clipboard:read') result = clipboard;
    send({ hostId: message.hostId, result });
  } else if (message.id) {
    const request = pending.get(message.id); if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    message.error ? request.reject(new Error(message.error)) : request.resolve(message.result);
  }
});
child.on('error', error => { for (const item of pending.values()) item.reject(error); });
child.on('exit', code => { for (const item of pending.values()) item.reject(new Error(`Service exited ${code}: ${diagnostics}`)); });
function call(method, ...args) {
  return new Promise((resolveCall, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`Timeout ${method}: ${diagnostics}`)); }, 20_000);
    pending.set(requestId, { resolve: resolveCall, reject, timer }); send({ id: requestId, method, args });
  });
}
try {
  const snapshot = await call('app:snapshot');
  assert.equal(snapshot.appVersion, version); assert.equal(snapshot.models.length, 19);
  assert.ok(snapshot.models.every(item => item.supported), 'Every catalog model must have a working engine registered.');
  assert.equal(snapshot.settings.launchAtStartup, true); assert.equal(snapshot.hotkeyRegistered, true);
  await call('settings:save', { appLanguage: 'en', historyLimit: 25, windowSize: 'medium', textReplacements: [{ from: 'вакейра', to: 'Vokeyra' }] });
  const changed = await call('app:snapshot');
  assert.equal(changed.settings.historyLimit, 25); assert.equal(changed.settings.appLanguage, 'en');
  assert.equal(JSON.parse(await readFile(join(dataPath, 'settings.json'), 'utf8')).windowSize, 'medium');
  assert.deepEqual(changed.settings.textReplacements, [{ from: 'вакейра', to: 'Vokeyra' }]);
  await call('clipboard:copy', 'Vokeyra Tauri ✓'); assert.equal(clipboard, 'Vokeyra Tauri ✓');
  await assert.rejects(call('settings:save', { historyLimit: 101 }));
  await assert.rejects(call('recording:begin'), /модель/);
  await call('settings:reset'); assert.equal((await call('app:snapshot')).settings.historyLimit, 5);
  assert.deepEqual((await call('app:snapshot')).settings.textReplacements, []);
  await call('history:clear'); assert.equal(await call('models:delete-all'), 0);
  await call('service:shutdown');
  console.log('Tauri service smoke passed: startup, native helper, catalog, settings, clipboard bridge, validation and cleanup.');
} finally {
  child.stdin.end();
  await new Promise(resolveExit => { if (child.exitCode !== null) resolveExit(); else { child.once('exit', resolveExit); setTimeout(() => child.kill(), 2000).unref(); } });
  await rm(dataPath, { recursive: true, force: true });
}
