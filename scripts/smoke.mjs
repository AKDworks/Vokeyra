import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile, readdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

// Tests always use an isolated profile. No real microphone or user settings.
const root = resolve('.');
await mkdir('.tmp', { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'vokeyra-smoke-'));
const entry = join(profile, 'entry.cjs');
const full = process.argv.includes('--whisper');
const dev = process.argv.includes('--dev');
const nativeInput = !process.argv.includes('--no-native-input');
if (full && nativeInput && process.platform === 'win32' && !(await stat('.tmp/NativeKeySender.exe').then(async file => file.mtimeMs >= (await stat('tests/NativeKeySender.cs')).mtimeMs).catch(() => false))) {
  await new Promise((done, reject) => {
    const compiler = spawn(join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), ['/nologo', '/out:' + resolve('.tmp/NativeKeySender.exe'), resolve('tests/NativeKeySender.cs')], { windowsHide: true, stdio: 'inherit' });
    compiler.on('error', reject); compiler.on('exit', code => code === 0 ? done() : reject(new Error('Key sender compilation failed')));
  });
}
let devServer;
if (dev) {
  let existing = false;
  try {
    const response = await fetch('http://127.0.0.1:5173', { signal: AbortSignal.timeout(1000) });
    existing = response.ok && (await response.text()).includes('<title>Vokeyra</title>');
  } catch { /* Start a local server if development mode is not already running. */ }
  if (!existing) {
    const { createServer } = await import('vite');
    devServer = await createServer();
    await devServer.listen();
  }
}
const audio = resolve('.tmp/integration/jfk.wav');
await writeFile(entry, `const {app}=require('electron');
app.setPath('userData', ${JSON.stringify(profile)});
app.setAppPath(${JSON.stringify(root)});
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
${full ? `app.commandLine.appendSwitch('use-file-for-fake-audio-capture', ${JSON.stringify(audio)});` : ''}
require(${JSON.stringify(resolve('dist/main/index.cjs'))});`);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.VOKEYRA_DEV_URL;
if (dev) env.VOKEYRA_DEV_URL = 'http://127.0.0.1:5173';
const app = await electron.launch({ args: [entry], env, timeout: 30_000 });
const errors = [];
app.process().stderr.on('data', data => console.error(String(data)));
try {
  const findMain = () => app.windows().find(w => w.url().endsWith('/index.html') || (dev && w.url() === 'http://127.0.0.1:5173/'));
  await expect.poll(findMain, { timeout: 30_000 }).toBeTruthy();
  const page = findMain();
  page.setDefaultTimeout(30_000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => window.vokeyra && document.querySelector('#notice')?.textContent);
  await expect(page.locator('#brand-logo')).toHaveJSProperty('complete', true);
  await expect(page.locator('#brand-logo')).toHaveJSProperty('naturalWidth', 4096);
  assert.equal(await page.title(), 'Vokeyra');
  const styles = await page.evaluate(() => ({
    layout: getComputedStyle(document.querySelector('.app')).display,
    accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    background: getComputedStyle(document.documentElement).backgroundColor,
  }));
  assert.deepEqual(styles, { layout: 'grid', accent: '#8bb99a', background: 'rgb(41, 42, 41)' }, 'Application CSS must load under the actual CSP');
  const options = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Vokeyra');
    return { size: w.getContentSize(), resizable: w.isResizable(), maximizable: w.isMaximizable(), fullscreenable: w.isFullScreenable(), prefs: w.webContents.getLastWebPreferences() };
  });
  assert.deepEqual(options.size, [780, 600]);
  assert.equal(options.resizable, false);
  assert.equal(options.maximizable, false);
  assert.equal(options.fullscreenable, false);
  assert.equal(options.prefs.sandbox, true);
  assert.equal(options.prefs.contextIsolation, true);
  assert.equal(options.prefs.nodeIntegration, false);
  await expect(page.locator('#microphone')).toBeEnabled();
  assert.equal(await page.locator('#general h1').count(), 0);
  assert.deepEqual(await page.locator('#general h2').allTextContents(), ['Общее', 'Звук']);
  await expect(page.locator('#output-device')).toBeDisabled();
  await page.locator('#audio-feedback').click();
  await expect(page.locator('#output-device')).toBeEnabled();
  await page.locator('#feedback-volume').fill('35');
  await page.locator('#feedback-volume').dispatchEvent('change');
  await expect.poll(async () => (await page.evaluate(() => window.vokeyra.snapshot())).settings.feedbackVolume).toBe(35);
  await page.locator('#input-channel').click();
  await page.getByRole('option', { name: 'Первый канал', exact: true }).click();
  await expect.poll(async () => (await page.evaluate(() => window.vokeyra.snapshot())).settings.inputChannel).toBe('first');
  await page.locator('#audio-feedback').click();
  await expect(page.locator('#output-device')).toBeDisabled();
  await page.locator('#push-to-talk').click();
  await expect.poll(async () => (await page.evaluate(() => window.vokeyra.snapshot())).settings.pushToTalk).toBe(true);
  await page.locator('#push-to-talk').click();
  await expect.poll(async () => (await page.evaluate(() => window.vokeyra.snapshot())).settings.pushToTalk).toBe(false);
  const hotkeyInfo = page.getByRole('button', { name: 'О горячей клавише', exact: true });
  const tooltip = page.locator('#' + await hotkeyInfo.getAttribute('aria-describedby'));
  await hotkeyInfo.hover();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText('одну клавишу или сочетание');
  await page.screenshot({ path: '.tmp/info-tooltip.png' });
  const tooltipBox = await tooltip.boundingBox();
  await page.mouse.move(tooltipBox.x + 20, tooltipBox.y + 20);
  await expect(tooltip).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tooltip).toBeHidden();
  await hotkeyInfo.focus();
  await expect(tooltip).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(tooltip).toBeHidden();
  // Inspect every tab at the fixed application size, including footer and model metadata.
  for (const tab of ['general', 'history', 'models', 'advanced', 'about']) {
    await page.locator(`nav [data-tab="${tab}"]`).click();
    const issues = await page.evaluate(() => [...document.querySelectorAll('.app *')].flatMap(element => {
      if (!element.checkVisibility() || ![...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())) return [];
      const problems = [];
      if (parseFloat(getComputedStyle(element).fontSize) < 14) problems.push(`Small text: ${element.outerHTML}`);
      if (element.scrollWidth > element.clientWidth + 1) problems.push(`Horizontal overflow: ${element.outerHTML}`);
      return problems;
    }));
    assert.deepEqual(issues, [], `${tab}: text must remain readable and fit`);
    await page.screenshot({ path: `.tmp/typography-${tab}.png` });
  }
  await page.getByRole('button', { name: 'История', exact: true }).click();
  await page.locator('#manual-recording summary').click();
  await page.locator('#record').click();
  await page.waitForFunction(() => document.querySelector('#notice')?.textContent?.includes('Скачайте'));
  await page.getByRole('button', { name: 'Модели', exact: true }).click();
  const catalogModelCount = await page.evaluate(async () => (await window.vokeyra.snapshot()).models.length);
  assert.equal(await page.locator('.model-card').count(), catalogModelCount);
  await page.screenshot({ path: '.tmp/models.png' });
  await page.getByRole('button', { name: 'Главное', exact: true }).click();
  await page.locator('#hotkey').click();
  await page.waitForFunction(() => document.querySelector('#hotkey').textContent.includes('Нажмите'));
  await page.keyboard.press('F8');
  await page.waitForFunction(() => document.querySelector('#hotkey').textContent === 'F8');
  assert.equal(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('F8')), true);
  assert.equal((await page.evaluate(() => window.vokeyra.snapshot())).busy, false);
  // Reassigning the same key also works because registration is suspended during capture.
  await page.locator('#hotkey').click();
  await page.waitForFunction(() => document.querySelector('#hotkey').textContent.includes('Нажмите'));
  assert.equal(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('F8')), false);
  await page.locator('#cancel-hotkey').click();
  await page.waitForFunction(() => document.querySelector('#hotkey').textContent === 'F8');
  assert.equal(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('F8')), true);
  await page.locator('#hotkey').click();
  await page.waitForFunction(() => document.querySelector('#hotkey').textContent.includes('Нажмите'));
  await page.keyboard.press('Control+Alt+F8');
  await page.waitForFunction(() => document.querySelector('#hotkey').textContent === 'Ctrl + Alt + F8');
  assert.equal(await page.locator('select').count(), 0, 'No native browser dropdown');
  await page.locator('#language').click();
  await page.getByRole('option', { name: 'Español', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#language [data-value]').textContent === 'Español' && !document.querySelector('#language').disabled);
  assert.equal((await page.evaluate(() => window.vokeyra.snapshot())).settings.language, 'es');
  // Navigation previews an option; Escape discards it and returns to the selected value.
  await page.locator('#language').click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#language').getAttribute('aria-expanded'), 'false');
  assert.equal((await page.evaluate(() => window.vokeyra.snapshot())).settings.language, 'es');
  await page.locator('#language').click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#notice')?.textContent === 'Язык сохранён.');
  await page.waitForFunction(() => document.querySelector('#language [data-value]').textContent === 'Русский' && !document.querySelector('#language').disabled);
  assert.equal((await page.evaluate(() => window.vokeyra.snapshot())).settings.language, 'ru');
  await page.locator('#language').click();
  await page.screenshot({ path: '.tmp/language-dropdown.png' });
  const focusStyle = await page.locator('#language').evaluate(element => ({ outline: getComputedStyle(element).outlineStyle, border: getComputedStyle(element).borderWidth, shadow: getComputedStyle(element).boxShadow }));
  assert.deepEqual(focusStyle, { outline: 'none', border: '1px', shadow: 'none' });
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('#language').getAttribute('aria-expanded'), 'false');
  await page.locator('#language').click();
  await page.locator('#general h2').first().click();
  assert.equal(await page.locator('#language').getAttribute('aria-expanded'), 'false');
  await page.locator('#hotkey').focus();
  assert.equal(await page.locator('#hotkey').evaluate(element => getComputedStyle(element).outlineStyle), 'none');
  assert.equal((await page.evaluate(() => window.vokeyra.snapshot())).settings.hotkey, 'Control+Alt+F8');
  // A malformed catalog value must not flow across the IPC boundary.
  assert.match(await page.evaluate(async () => { try { await window.vokeyra.downloadModel('../escape'); return ''; } catch (e) { return String(e); } }), /Некорректный ID/);
  if (full) {
    await page.getByRole('button', { name: 'Модели', exact: true }).click();
    await page.locator('.model-card[data-model="whisper-tiny"]').click();
    console.log('Downloading and verifying Whisper Tiny through the application…');
    await page.waitForFunction(async () => {
      const s = await window.vokeyra.snapshot();
      const error = s.downloads.find(d => d.phase === 'error');
      if (error) throw new Error(error.error);
      return s.models.some(m => m.installed);
    }, undefined, { timeout: 180_000 });
    console.log('Model installed and selected automatically. Starting fake microphone…');
    await page.waitForFunction(async () => {
      const s = await window.vokeyra.snapshot();
      return s.models.some(model => model.installed && model.model.id === s.settings.selectedModelId);
    });
    await page.evaluate(async () => {
      const s = await window.vokeyra.snapshot();
      await window.vokeyra.saveSettings({ hotkey: s.settings.hotkey, language: 'en' });
    });
    await page.getByRole('button', { name: 'Главное', exact: true }).click();
    // Deliver the exact IPC event used by the registered global shortcut.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Vokeyra').minimize());
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Vokeyra').webContents.send('recording:toggle'));
    await page.waitForFunction(() => document.querySelector('#record-status')?.textContent?.startsWith('Идёт запись'));
    const overlay = app.windows().find(w => w.url().includes('overlay.html'));
    assert.ok(overlay, 'Separate recording overlay exists');
    await overlay.waitForFunction(() => document.body.dataset.phase === 'recording');
    const overlayState = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Vokeyra — запись');
      return { visible: w.isVisible(), focusable: w.isFocusable(), topmost: w.isAlwaysOnTop(), focused: w.isFocused() };
    });
    assert.deepEqual(overlayState, { visible: true, focusable: false, topmost: true, focused: false });
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Vokeyra').isMinimized()), true);
    await overlay.screenshot({ path: '.tmp/overlay.png', omitBackground: true });
    console.log('Microphone recording started.');
    // Collect the standard 11-second JFK sample through Chromium's fake microphone.
    await new Promise(resolve => setTimeout(resolve, 11_000));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Vokeyra').webContents.send('recording:toggle'));
    await page.waitForFunction(() => {
      const message = document.querySelector('#notice');
      if (message?.classList.contains('error') && message.textContent) throw new Error(message.textContent);
      return message?.textContent?.includes('Текст скопирован');
    }, undefined, { timeout: 120_000 });
    const text = await page.locator('#transcript').inputValue();
    assert.match(text.toLowerCase(), /country|fellow|americans/);
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
    assert.equal(copied, text);
    assert.deepEqual(await readdir(join(profile, 'recordings')), []);
    assert.equal((await page.evaluate(() => window.vokeyra.snapshot())).history[0].text, text);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Vokeyra').restore());
    await page.getByRole('button', { name: 'История', exact: true }).click();
    assert.equal(await page.locator('.history-entry').count(), 1);
    await page.screenshot({ path: '.tmp/history.png' });
    await page.getByRole('button', { name: 'Главное', exact: true }).click();
    console.log('Real whisper.cpp transcription:', text);
    // Verify microphone cancellation releases the main-process recording lock.
    await page.getByRole('button', { name: 'История', exact: true }).click();
    await page.locator('#record').click();
    await page.waitForFunction(() => document.querySelector('#record-status')?.textContent?.startsWith('Идёт запись'));
    await overlay.locator('#cancel').click();
    await page.waitForFunction(() => document.querySelector('#record-status')?.textContent === 'Готово к записи');
    assert.equal((await page.evaluate(() => window.vokeyra.snapshot())).busy, false);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Vokeyra — запись').isVisible()), false);
    await page.getByRole('button', { name: 'История', exact: true }).click();
    await page.locator('.history-entry').getByRole('button', { name: 'Удалить' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.history-entry').length === 0);
    // Exercise real Windows global down/repeat/up while the main window is minimized.
    if (process.platform === 'win32') {
      await page.evaluate(() => window.vokeyra.saveSettings({ hotkey: 'F24', pushToTalk: true, muteWhileRecording: true, audioFeedback: true, feedbackVolume: 20 }));
      await page.reload();
      await expect(page.locator('#push-to-talk')).toHaveAttribute('aria-checked', 'true');
      await expect(page.locator('#microphone')).toBeEnabled();
      await page.locator('#output-device').click();
      await expect(page.locator('#output-device-options')).toBeVisible();
      const menuBounds = await page.locator('#output-device-options').boundingBox();
      assert.ok(menuBounds.y >= 0 && menuBounds.y + menuBounds.height <= 560, 'Output menu stays inside the small window');
      await page.keyboard.press('Escape');
      await page.locator('#preview-feedback').click();
      await expect(page.locator('#preview-feedback')).toBeEnabled();
      assert.equal(await page.locator('#notice').evaluate(node => node.classList.contains('error')), false);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Vokeyra').minimize());
      if (nativeInput) {
        const keySender = spawn(resolve('.tmp/NativeKeySender.exe'), ['135', '3000'], { windowsHide: true });
        keySender.on('error', error => errors.push(error.message));
      } else await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Vokeyra').webContents.send('recording:hold', true));
      await page.waitForFunction(() => document.querySelector('#record-status')?.textContent?.startsWith('Идёт запись'));
      await expect(page.locator('#microphone')).toBeDisabled();
      if (!nativeInput) {
        await new Promise(resolve => setTimeout(resolve, 1500));
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Vokeyra').webContents.send('recording:hold', false));
      }
      await page.waitForFunction(async () => (await window.vokeyra.snapshot()).history.length === 1, undefined, { timeout: 60_000 });
      await expect.poll(async () => (await page.evaluate(() => window.vokeyra.snapshot())).busy).toBe(false);
      console.log(`${nativeInput ? 'Real Windows global hold/repeat/release' : 'IPC hold/release'} → microphone → Whisper passed.`);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Vokeyra').restore());
      // A release during microphone setup must not leave an unattended recording.
      await app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Vokeyra');
        w.webContents.send('recording:hold', true); w.webContents.send('recording:hold', false);
      });
      await page.waitForFunction(() => document.querySelector('#record-status')?.textContent === 'Готово к записи' && document.querySelector('#notice')?.textContent === 'Запись отменена.');
      await expect.poll(async () => (await page.evaluate(() => window.vokeyra.snapshot())).busy).toBe(false);
    }
  }
  await page.getByRole('button', { name: 'Главное', exact: true }).click();
  await page.screenshot({ path: '.tmp/dictation.png' });
  assert.deepEqual(errors, []);
  console.log(`Electron smoke passed${full ? ' including real audio → whisper.cpp → clipboard' : ''}. Profile: ${profile}`);
} catch (error) {
  const page = app.windows().find(w => !w.url().includes('overlay.html'));
  if (page) { console.error(await page.locator('body').innerText()); await page.screenshot({ path: '.tmp/smoke-failure.png' }); }
  throw error;
} finally { await app.close(); await devServer?.close(); }

