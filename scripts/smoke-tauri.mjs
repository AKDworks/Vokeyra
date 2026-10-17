import { chromium } from '@playwright/test';
import { createServer as viteServer } from 'vite';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, mkdir, readdir, link, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const profile = await mkdtemp(resolve('.tmp/tauri-ui-'));
const { version } = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
const testSettings = { launchAtStartup: false, showTrayIcon: false, windowSize: 'compact', appLanguage: 'ru', pasteMethod: 'none', clipboardHandling: 'keep' };
const sourceModel = join(process.env.APPDATA || '', 'Vokeyra/models/gigaam-v3-e2e-rnnt');
let withModel = false;
if (await readFile(join(sourceModel, 'installed.json'), 'utf8').then(() => true).catch(() => false)) {
  async function linkModel(source, target) {
    await mkdir(target, { recursive: true });
    for (const entry of await readdir(source, { withFileTypes: true })) {
      const from = join(source, entry.name), to = join(target, entry.name);
      if (entry.isDirectory()) await linkModel(from, to);
      else if (entry.isFile()) await link(from, to).catch(() => copyFile(from, to));
    }
  }
  await linkModel(sourceModel, join(profile, 'models/gigaam-v3-e2e-rnnt'));
  testSettings.selectedModelId = 'gigaam-v3-e2e-rnnt'; withModel = true;
}
await writeFile(join(profile, 'settings.json'), JSON.stringify(testSettings));
const port = await new Promise(resolvePort => {
  const server = createServer(); server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolvePort(port)); });
});
const executableArg = process.argv.indexOf('--exe');
const executable = executableArg >= 0 ? process.argv[executableArg + 1] : undefined;
if (executableArg >= 0 && !executable) throw new Error('--exe requires an executable path.');
const release = process.argv.includes('--release') || !!executable;
const permissionRecovery = process.argv.includes('--permission-recovery');
if (permissionRecovery) {
  const origin = release ? 'https://tauri.localhost' : 'http://127.0.0.1:1420';
  const preferences = { profile: { content_settings: { exceptions: { media_stream_mic: { [`${origin},*`]: { setting: 2 } } } } } };
  for (const folder of ['Default', 'EBWebView/Default']) {
    await mkdir(join(profile, 'webview', folder), { recursive: true });
    await writeFile(join(profile, 'webview', folder, 'Preferences'), JSON.stringify(preferences));
  }
}
const nativeKeys = process.argv.includes('--native-keys');
if (nativeKeys) await new Promise((done, reject) => {
  const compiler = spawn(join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
    ['/nologo', '/out:' + resolve('.tmp/NativeKeySender.exe'), resolve('tests/NativeKeySender.cs')], { windowsHide: true, stdio: 'inherit' });
  compiler.on('error', reject); compiler.on('exit', code => code === 0 ? done() : reject(new Error('Key sender compilation failed')));
});
let vite;
const existing = await fetch('http://127.0.0.1:1420').then(response => response.text()).catch(() => '');
if (existing) assert.ok(existing.includes('<title>Vokeyra</title>'), 'Port 1420 belongs to another application.');
else if (!release) { vite = await viteServer(); await vite.listen(); }
const child = spawn(executable ? resolve(executable) : resolve(`src-tauri/target/${release ? 'release' : 'debug'}/vokeyra.exe`), [], {
  env: { ...process.env, VOKEYRA_TEST_DATA: profile, WEBVIEW2_USER_DATA_FOLDER: join(profile, 'webview'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
    `--remote-debugging-port=${port} ${process.argv.includes('--real-microphone') ? '' : '--use-fake-device-for-media-stream'} ${permissionRecovery ? '' : '--use-fake-ui-for-media-stream'}` },
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});
let diagnostics = '', browser, page, assignmentSender;
async function waitForSnapshot(predicate, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (true) {
    const state = await page.evaluate(() => window.vokeyra.snapshot());
    if (predicate(state)) return state;
    if (Date.now() > deadline) throw new Error(`Snapshot condition timed out: hotkey=${state.settings.hotkey}, registered=${state.hotkeyRegistered}, busy=${state.busy}`);
    await delay(100);
  }
}
child.stderr.on('data', data => { diagnostics = (diagnostics + data).slice(-12000); });
try {
  const deadline = Date.now() + 45_000;
  while (true) {
    if (child.exitCode !== null) throw new Error(`Tauri exited ${child.exitCode}: ${diagnostics}`);
    if (await fetch(`http://127.0.0.1:${port}/json/version`).then(r => r.ok).catch(() => false)) break;
    if (Date.now() > deadline) throw new Error(`WebView2 did not start: ${diagnostics}`);
    await delay(200);
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  while (!page) {
    page = browser.contexts().flatMap(context => context.pages()).find(item => (item.url().includes('127.0.0.1:1420') || item.url().includes('tauri.localhost')) && !item.url().includes('overlay.html'));
    if (!page) { if (Date.now() > deadline) throw new Error('Main WebView unavailable.'); await delay(100); }
  }
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await page.waitForFunction(() => document.body.classList.contains('booting') === false, null, { timeout: 30_000 });
  await page.evaluate(() => { window.shortcutEvents = []; window.vokeyra.onHold(value => window.shortcutEvents.push({ value, time: Date.now() })); });
  const snapshot = await page.evaluate(() => window.vokeyra.snapshot());
  assert.equal(snapshot.models.length, 19); assert.equal(snapshot.appVersion, version);
  assert.equal(await page.locator('#footer-version').innerText(), `Vokeyra ${version}`);
  assert.equal(await page.locator('#app-version').innerText(), `v${version}`);
  assert.equal(snapshot.hotkeyRegistered, true);
  if (permissionRecovery) {
    assert.equal(await page.evaluate(async () => (await navigator.permissions.query({ name: 'microphone' })).state), 'denied');
    await page.locator('#microphone-access-help').waitFor({ state: 'visible' });
    assert.match(await page.locator('#microphone-access-status').innerText(), /заблокирован/);
    await page.evaluate(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      const gate = new Promise(resolve => { window.allowMicrophoneRequest = resolve; });
      navigator.mediaDevices.getUserMedia = async constraints => { await gate; return original(constraints); };
    });
    await page.locator('#allow-microphone').click();
    const resetBy = Date.now() + 10000;
    while (await page.evaluate(async () => (await navigator.permissions.query({ name: 'microphone' })).state) === 'denied') {
      if (Date.now() > resetBy) throw new Error('Saved microphone denial was not reset.');
      await delay(100);
    }
    assert.equal(await page.evaluate(async () => (await navigator.permissions.query({ name: 'microphone' })).state), 'granted');
    await page.evaluate(() => window.allowMicrophoneRequest());
    await page.waitForFunction(() => document.getElementById('microphone-access-status').textContent === 'Доступ к микрофону разрешён.');
    await page.waitForFunction(() => !document.getElementById('allow-microphone').disabled);
    await page.screenshot({ path: '.tmp/microphone-access.png', scale: 'css' });
    console.log('Saved microphone denial → Allow button → native permission grant → microphone access passed (no CDP permission override).');
  }
  if (withModel) {
    assert.ok(snapshot.models.find(item => item.model.id === 'gigaam-v3-e2e-rnnt')?.installed, 'Fixture model must be discovered.');
    assert.equal(snapshot.settings.selectedModelId, 'gigaam-v3-e2e-rnnt');
    await page.evaluate(() => window.vokeyra.selectModel('gigaam-v3-e2e-rnnt'));
  }
  // Focus the host before capture begins: activating a test sender during
  // capture can produce a real blur, which must cancel assignment.
  let assignmentKey;
  if (nativeKeys) {
    const sender = spawn(resolve('.tmp/NativeKeySender.exe'), ['120', '200', String(child.pid), 'wait'], { windowsHide: true, stdio: 'pipe' });
    assignmentSender = sender;
    const ready = new Promise((done, reject) => { sender.stdout.once('data', done); sender.once('error', reject); });
    const finished = new Promise((done, reject) => { sender.once('error', reject); sender.once('exit', code => code === 0 ? done() : reject(new Error('Native key sender failed'))); });
    await ready;
    assignmentKey = () => { sender.stdin.end('\n'); return finished; };
  }
  await page.locator('#hotkey').click();
  await page.locator('#hotkey.capturing').waitFor();
  if (nativeKeys) await assignmentKey();
  else await page.keyboard.press('F9');
  await waitForSnapshot(state => state.settings.hotkey === 'F9' && state.hotkeyRegistered);
  await page.waitForFunction(() => !document.getElementById('hotkey').classList.contains('capturing'));
  assert.equal(JSON.parse(await readFile(join(profile, 'settings.json'), 'utf8')).hotkey, 'F9');
  assert.equal((await page.evaluate(() => window.vokeyra.snapshot())).busy, false, 'Assigning a shortcut must not start recording.');
  await page.locator('#hotkey').click();
  await page.locator('#hotkey.capturing').waitFor();
  await page.locator('#cancel-hotkey').click();
  await page.waitForFunction(() => !document.getElementById('hotkey').classList.contains('capturing'));
  await waitForSnapshot(state => state.settings.hotkey === 'F9' && state.hotkeyRegistered);
  if (nativeKeys && withModel) {
    await page.locator('#push-to-talk').click();
    await waitForSnapshot(state => state.settings.pushToTalk);
    await page.locator('#mute-recording').click();
    await waitForSnapshot(state => state.settings.muteWhileRecording);
    await page.locator('#audio-feedback').click();
    await waitForSnapshot(state => state.settings.audioFeedback);
    const sender = spawn(resolve('.tmp/NativeKeySender.exe'), ['120', '5500', String(child.pid)], { windowsHide: true, stdio: 'inherit' });
    const released = new Promise((done, reject) => { sender.on('error', reject); sender.on('exit', code => code === 0 ? done() : reject(new Error('Native key sender failed'))); });
    await page.waitForFunction(() => /Идёт запись/.test(document.getElementById('record-status').textContent), null, { timeout: 4000 });
    await delay(750);
    assert.match(await page.locator('#record-status').innerText(), /Идёт запись/);
    await released;
    await waitForSnapshot(state => !state.busy && state.history.some(entry => entry.status === 'complete'), 60000);
    await page.waitForFunction(() => document.getElementById('record-status').textContent === 'Готово к записи');
    console.log('Native Windows hotkey: assignment, hold, repeat, release and transcription passed.');
  }
  await page.locator('[data-tab="advanced"]').click();
  await page.locator('#replacement-from').fill('вакейра');
  await page.locator('#replacement-to').fill('Vokeyra');
  await page.locator('#replacement-form button').click();
  await page.locator('#replacement-list .replacement-item').waitFor();
  assert.deepEqual((await page.evaluate(() => window.vokeyra.snapshot())).settings.textReplacements,
    [{ from: 'вакейра', to: 'Vokeyra' }]);
  await page.locator('#replacement-from').fill('ВАКЕЙРА');
  await page.locator('#replacement-to').fill('duplicate');
  await page.locator('#replacement-form button').click();
  await page.locator('#replacement-error').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#replacement-list .replacement-item').count(), 1);
  await page.locator('#replacement-list .icon-button').click();
  await page.locator('#replacement-list').waitFor({ state: 'hidden' });
  const before = await page.evaluate(() => ({ x: window.screenX, y: window.screenY }));
  await page.evaluate(() => window.vokeyra.saveSettings({ modelUnloadDelay: '2m' }));
  const after = await page.evaluate(() => ({ x: window.screenX, y: window.screenY }));
  assert.deepEqual(after, before);
  await page.evaluate(() => window.vokeyra.saveSettings({ windowSize: 'medium' }));
  await page.waitForFunction(() => window.innerWidth === 920);
  await page.evaluate(() => window.vokeyra.saveSettings({ appLanguage: 'en' }));
  await page.locator('#replacement-from').fill('пример');
  await page.locator('#replacement-to').fill('Добавить');
  await page.locator('#replacement-form button').click();
  await page.locator('#replacement-list .replacement-item').waitFor();
  assert.equal(await page.locator('#replacement-list .replacement-text').textContent(), 'пример → Добавить');
  assert.equal(await page.locator('#replacement-from').getAttribute('placeholder'), 'Recognized as');
  await page.locator('#replacement-form').screenshot({ path: '.tmp/word-replacements.png' });
  assert.equal((await page.evaluate(() => window.vokeyra.snapshot())).settings.appLanguage, 'en');
  const audio = await page.evaluate(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const track = stream.getAudioTracks()[0]; const result = track.readyState; stream.getTracks().forEach(item => item.stop()); return result;
  });
  assert.equal(audio, 'live');
  const overlay = browser.contexts().flatMap(context => context.pages()).find(item => item.url().includes('overlay.html'));
  assert.ok(overlay);
  await assert.rejects(overlay.evaluate(() => window.__TAURI_INTERNALS__.invoke('service_request', { method: 'app:snapshot', args: [] })));
  if (withModel) {
    await page.evaluate(async () => {
      const id = await window.vokeyra.beginRecording();
      window.meterSession = id;
      for (const level of [0, .1, .25, .5, .8, .2, .4, 1, 0, .3, .7, .1]) window.vokeyra.recordingLevel(id, level, 1);
    });
    await overlay.waitForFunction(() => {
      const heights = [...document.querySelectorAll('#levels i')].map(bar => parseFloat(bar.style.height));
      return heights.some(height => height > 18) && heights.some(height => height < 6);
    });
    await page.evaluate(() => window.vokeyra.cancelRecording());
    console.log('Overlay meter: continuous voice levels and individual bar heights passed.');
    await page.evaluate(() => document.getElementById('record').click());
    await page.waitForFunction(() => /Идёт запись|Recording/.test(document.getElementById('record-status').textContent), null, { timeout: 15_000 });
    await delay(800);
    await page.evaluate(() => document.getElementById('record').click());
    const completedBy = Date.now() + 60_000;
    let recorded;
    while (true) {
      recorded = await page.evaluate(() => window.vokeyra.snapshot());
      if (!recorded.busy && recorded.history.some(entry => entry.status === 'complete')) break;
      if (recorded.history.some(entry => entry.status === 'failed')) throw new Error('Transcription failed.');
      if (Date.now() > completedBy) throw new Error('Transcription did not complete.');
      await delay(200);
    }
    assert.equal(recorded.history[0].hasAudio, true);
    assert.ok(await page.evaluate(async id => (await window.vokeyra.historyAudio(id)).byteLength > 44, recorded.history[0].id));
    console.log('WebView microphone → AudioWorklet → Tauri IPC → GigaAM → history passed.');
  }
  await assert.rejects(page.evaluate(() => window.__TAURI_INTERNALS__.invoke('service_request', { method: 'service:shutdown', args: [] })));
  if (nativeKeys) {
    await page.locator('#replacement-from').fill('');
    await page.locator('#replacement-from').focus();
    const typed = 'Vokeyra Кирилл 😊';
    const worker = spawn(executable ? resolve(executable) : resolve(`src-tauri/target/${release ? 'release' : 'debug'}/vokeyra.exe`),
      ['--desktop-worker', String(process.pid)], { windowsHide: true, stdio: 'pipe' });
    try {
      await new Promise((done, reject) => {
        const timeout = setTimeout(() => reject(new Error('Native Unicode typing timed out')), 5000);
        worker.once('error', error => { clearTimeout(timeout); reject(error); });
        worker.stdout.once('data', data => { clearTimeout(timeout); String(data).startsWith('1\tok\t') ? done() : reject(new Error(String(data))); });
        worker.stdin.end(`1\ttype\t${Buffer.from(typed).toString('base64')}\n`);
      });
      await page.waitForFunction(value => document.getElementById('replacement-from').value === value, typed, { timeout: 3000 });
      assert.equal(await page.locator('#replacement-from').inputValue(), typed);
    } finally { worker.kill(); }
    console.log('Native Windows Unicode typing passed.');
  }
  assert.equal((await page.evaluate(() => window.vokeyra.snapshot())).appVersion, version);
  assert.deepEqual(errors, []);
  const layout = await page.evaluate(() => ({ width: window.innerWidth, content: document.documentElement.scrollWidth,
    footerRight: document.getElementById('footer-version').getBoundingClientRect().right }));
  assert.ok(layout.content <= layout.width && layout.footerRight <= layout.width, JSON.stringify(layout));
  await page.screenshot({ path: '.tmp/tauri-ui.png', scale: 'css' });
  console.log('Tauri WebView smoke passed: interface, IPC, catalog, shortcuts, settings, stable window position and microphone.');
} catch (error) {
  console.error(diagnostics);
  if (page) {
    console.error(await page.evaluate(() => ({ notice: document.getElementById('notice-text')?.textContent, status: document.getElementById('record-status')?.textContent, shortcutEvents: window.shortcutEvents })).catch(() => ({})));
    await page.screenshot({ path: '.tmp/tauri-failure.png' }).catch(() => {});
  }
  throw error;
}
finally {
  assignmentSender?.stdin.end();
  await browser?.close(); child.kill();
  await vite?.close();
  await delay(700);
  // The WebView browser process may still be releasing its cache. Preserve a
  // failed cleanup under the ignored test folder instead of touching user data.
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
