import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
await mkdir(resolve('.tmp'), { recursive: true });
const profile = await mkdtemp(resolve('.tmp/packaged-'));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: resolve('release/win-unpacked/Vokeyra.exe'), args: [`--user-data-dir=${profile}`, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'], env, timeout: 30_000 });
try {
  await expect.poll(() => app.windows().some(w => w.url().endsWith('/index.html')), { timeout: 30_000 }).toBe(true);
  const page = app.windows().find(w => w.url().endsWith('/index.html')); page.setDefaultTimeout(30_000);
  await page.waitForFunction(() => !!window.vokeyra);
  await expect(page.locator('#brand-logo')).toHaveJSProperty('complete', true);
  await expect(page.locator('#brand-logo')).toHaveJSProperty('naturalWidth', 4096);
  const runtime = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, userData: app.getPath('userData') }));
  assert.equal(runtime.packaged, true);
  assert.equal(runtime.userData, profile);
  const state = await page.evaluate(() => window.vokeyra.snapshot());
  assert.equal(state.models.length, 14);
  assert.equal(state.settings.selectedModelId, null);
  assert.equal(await page.title(), 'Vokeyra');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.app')).display), 'grid');
  assert.equal(await page.locator('nav button').count(), 5);
  await expect(page.locator('#microphone')).toBeEnabled();
  await expect(page.locator('#output-device')).toBeDisabled();
  await page.screenshot({ path: '.tmp/packaged.png' });
  console.log('Packaged Windows app passed: ASAR, preload, catalog, isolated profile.', runtime);
} finally { await app.close(); }
