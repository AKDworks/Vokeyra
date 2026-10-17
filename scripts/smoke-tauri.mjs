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
const release = process.argv.includes('--release');
let vite;
const existing = await fetch('http://127.0.0.1:1420').then(response => response.text()).catch(() => '');
if (existing) assert.ok(existing.includes('<title>Vokeyra</title>'), 'Port 1420 belongs to another application.');
else if (!release) { vite = await viteServer(); await vite.listen(); }
const child = spawn(resolve(`src-tauri/target/${release ? 'release' : 'debug'}/vokeyra.exe`), [], {
  env: { ...process.env, VOKEYRA_TEST_DATA: profile, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
    `--remote-debugging-port=${port} --use-fake-device-for-media-stream --use-fake-ui-for-media-stream` },
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});
let diagnostics = '', browser, page;
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
  const snapshot = await page.evaluate(() => window.vokeyra.snapshot());
  assert.equal(snapshot.models.length, 19); assert.equal(snapshot.appVersion, version);
  assert.equal(await page.locator('#footer-version').innerText(), `Vokeyra ${version}`);
  assert.equal(await page.locator('#app-version').innerText(), `v${version}`);
  assert.equal(snapshot.hotkeyRegistered, true);
  if (withModel) {
    assert.ok(snapshot.models.find(item => item.model.id === 'gigaam-v3-e2e-rnnt')?.installed, 'Fixture model must be discovered.');
    assert.equal(snapshot.settings.selectedModelId, 'gigaam-v3-e2e-rnnt');
    await page.evaluate(() => window.vokeyra.selectModel('gigaam-v3-e2e-rnnt'));
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
    console.error(await page.evaluate(() => ({ notice: document.getElementById('notice-text')?.textContent, status: document.getElementById('record-status')?.textContent })).catch(() => ({})));
    await page.screenshot({ path: '.tmp/tauri-failure.png' }).catch(() => {});
  }
  throw error;
}
finally {
  await browser?.close(); child.kill();
  await vite?.close();
  await delay(700);
  // The WebView browser process may still be releasing its cache. Preserve a
  // failed cleanup under the ignored test folder instead of touching user data.
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
