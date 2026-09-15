import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, session, shell, Tray } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { atomicJson, readJson } from './storage';
import { ModelManager } from './models';
import { desktop } from './platform/desktop';
import { EngineRegistry } from './engines/types';
import { WhisperCppEngine } from './engines/whisper';
import { GigaAmEngine } from './engines/gigaam';
import { SherpaEngine } from './engines/sherpa';
import { encodeWav, validateWav } from '../shared/wav';
import type { Settings, Snapshot } from '../shared/contracts';
import { HistoryStore } from './history';
import { RecordingOverlay, overlayUrl } from './overlay';
import { defaultPreferences, validatePreferences } from '../shared/preferences';
import { checkForUpdates, latestReleaseUrl } from './update';

app.setName('Vokeyra');
if (process.platform === 'win32') app.setAppUserModelId('org.vokeyra.desktop');
const defaults: Settings = { ...defaultPreferences, selectedModelId: null };
const engines = new EngineRegistry();
engines.register(new WhisperCppEngine());
engines.register(new GigaAmEngine());
engines.register(new GigaAmEngine('gigaam-multilingual-ctc', ['ru', 'en', 'kk', 'ky', 'uz']));
engines.register(new SherpaEngine('gigaam-v3-e2e-rnnt', ['ru']));
engines.register(new SherpaEngine('parakeet-tdt-0-6b-v3-int8', ['en', 'es', 'fr', 'de', 'bg', 'hr', 'cs', 'da', 'nl', 'et', 'fi', 'el', 'hu', 'it', 'lv', 'lt', 'mt', 'pl', 'pt', 'ro', 'sk', 'sl', 'sv', 'ru', 'uk']));
engines.register(new SherpaEngine('moonshine-tiny-en-int8', ['en']));
let settings = { ...defaults };
let window: BrowserWindow | null = null;
let models: ModelManager;
let history: HistoryStore;
let overlay: RecordingOverlay | undefined;
let tray: Tray | undefined;
let appIconPath = '';
let capturingShortcut = false;
let captureTimer: ReturnType<typeof setTimeout> | undefined;
let historyCleanupTimer: ReturnType<typeof setInterval> | undefined;
let hotkeyRegistered = false;
let recording: { id: string; modelId: string; controller: AbortController; transcribing: boolean } | null = null;
let recordingGeneration = 0;
let settingsPath: string;
let recordingsPath: string;
const transcriptionTasks = new Set<Promise<unknown>>();
let quitting = false;
let cleaned = false;
const devUrl = !app.isPackaged && process.env.VOKEYRA_DEV_URL === 'http://127.0.0.1:5173' ? process.env.VOKEYRA_DEV_URL : undefined;
const rendererUrl = pathToFileURL(join(__dirname, '../renderer/index.html')).href;
const trusted = (url: string) => devUrl ? new URL(url).origin === devUrl : url === rendererUrl;
let shortcutDown = false;
let heldRecording = false;
function syncTray(): void {
  if (settings.showTrayIcon && appIconPath) {
    if (!tray) tray = new Tray(nativeImage.createFromPath(appIconPath).resize({ width: 16, height: 16 }));
    tray.setToolTip('Vokeyra');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: settings.appLanguage === 'en' ? 'Open Vokeyra' : 'Открыть Vokeyra', click: () => { window?.restore(); window?.show(); window?.focus(); } },
      { type: 'separator' }, { label: settings.appLanguage === 'en' ? 'Quit' : 'Выйти', click: () => app.quit() },
    ]));
    if (tray.listenerCount('double-click') === 0) tray.on('double-click', () => { window?.restore(); window?.show(); window?.focus(); });
  } else if (!settings.showTrayIcon && tray) { tray.destroy(); tray = undefined; }
}
function syncStartup(): void {
  const args = app.isPackaged ? (settings.hideOnStartup ? ['--hidden'] : []) :
    [app.getAppPath(), ...(settings.hideOnStartup ? ['--hidden'] : [])];
  app.setLoginItemSettings({ openAtLogin: settings.launchAtStartup, path: process.execPath, args });
}
function prepareText(value: string): string {
  let text = value.trim();
  if (settings.removeFillerWords) text = text.replace(/(^|[\s,])(?:э+|эм+|м-м+)(?=$|[\s,.!?;:])/giu, '$1')
    .replace(/\s+([,.!?;:])/gu, '$1').replace(/\s{2,}/gu, ' ').trim();
  if (!settings.punctuation) text = text.replace(/\p{P}+/gu, '').replace(/\s{2,}/gu, ' ').trim();
  return text ? text + (settings.appendSpace ? ' ' : '') : '';
}
function voiceWav(wav: ArrayBuffer): ArrayBuffer {
  if (!settings.voiceActivityDetection) return wav;
  const view = new DataView(wav); const count = (wav.byteLength - 44) / 2; const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) samples[i] = view.getInt16(44 + i * 2, true) / 32768;
  const frame = 320; const levels: number[] = [];
  for (let start = 0; start < count; start += frame) {
    let sum = 0; const end = Math.min(count, start + frame);
    for (let i = start; i < end; i++) sum += samples[i]! * samples[i]!;
    levels.push(Math.sqrt(sum / Math.max(1, end - start)));
  }
  const threshold = Math.max(.008, Math.max(...levels) * .08); let first = levels.findIndex(level => level >= threshold);
  let last = levels.length - 1; while (last >= 0 && levels[last]! < threshold) last--;
  if (first < 0 || last < first) return wav;
  first = Math.max(0, first - 8); last = Math.min(levels.length - 1, last + 8);
  return encodeWav(samples.slice(first * frame, Math.min(count, (last + 1) * frame)));
}
const toggle = () => {
  if (capturingShortcut || shortcutDown || !window || window.isDestroyed()) return;
  shortcutDown = true;
  if (process.platform === 'win32') void desktop.watchRelease(settings.hotkey).catch(error => {
    shortcutDown = false;
    window?.webContents.send('recording:cancel-request');
    dialog.showErrorBox('Vokeyra: горячая клавиша', String(error));
  });
  else setTimeout(() => { shortcutDown = false; }, 250);
  if (settings.pushToTalk) { heldRecording = true; window.webContents.send('recording:hold', true); }
  else window.webContents.send('recording:toggle');
};
function endShortcutCapture(): void {
  if (!capturingShortcut) return;
  capturingShortcut = false;
  clearTimeout(captureTimer);
  try { hotkeyRegistered = desktop.registerShortcut(settings.hotkey, toggle); } catch { hotkeyRegistered = false; }
  window?.webContents.send('shortcut:capture-ended');
}
const idle = () => { if (recording) throw new Error('Сначала завершите запись или распознавание.'); };
const safeId = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(value)) throw new Error('Некорректный ID.');
  return value;
};
function validateSettings(value: unknown, base = defaultPreferences) {
  const result = validatePreferences(value, base);
  if (process.platform !== 'win32' && (result.pushToTalk || result.muteWhileRecording)) throw new Error('Удержание клавиши и системный звук пока доступны только в Windows.');
  return result;
}
function whisperExecutable(): string {
  return app.isPackaged ? join(process.resourcesPath, 'whisper', 'whisper-cli.exe') : join(app.getAppPath(), 'resources', 'whisper', 'whisper-cli.exe');
}
async function engineReady(): Promise<boolean> {
  const engine = settings.selectedModelId ? models?.installed.get(settings.selectedModelId)?.model.engine : undefined;
  if (!engine || !engines.has(engine)) return false;
  if (engine !== 'whisper.cpp') return true;
  try { return (await stat(whisperExecutable())).isFile(); } catch { return false; }
}
function languageForModel(model: { languages: string[] }, current: string): string {
  if (model.languages.length === 1) return model.languages[0]!;
  return current === 'auto' || model.languages.includes(current) ? current : 'auto';
}
async function snapshot(): Promise<Snapshot> {
  return { settings, models: models.views(id => engines.has(id)), downloads: [...models.downloads.values()],
    modelsPath: models.root, engineReady: await engineReady(), hotkeyRegistered, busy: !!recording,
    history: history.entries, dataPath: app.getPath('userData'), appVersion: app.getVersion() };
}
// Short mutations are serialized so disk state and shortcuts cannot race each other.
let mutations = Promise.resolve();
function handle(channel: string, fn: (...args: any[]) => unknown, serialize = false): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !trusted(event.senderFrame.url)) throw new Error('Недоверенный источник запроса.');
    if (!serialize) {
      if (channel === 'recording:transcribe' || channel === 'history:retranscribe') {
        const task = Promise.resolve(fn(...args));
        transcriptionTasks.add(task);
        return task.finally(() => { transcriptionTasks.delete(task); });
      }
      return fn(...args);
    }
    const next = mutations.then(() => fn(...args));
    mutations = next.then(() => undefined, () => undefined);
    return next;
  });
}
function registerIpc(): void {
  handle('app:snapshot', snapshot);
  handle('shortcut:begin-capture', () => {
    idle();
    if (!window?.isFocused()) throw new Error('Сначала выберите окно Vokeyra.');
    capturingShortcut = true;
    desktop.unregisterShortcut(settings.hotkey);
    hotkeyRegistered = false;
    clearTimeout(captureTimer);
    captureTimer = setTimeout(endShortcutCapture, 30_000);
  }, true);
  handle('shortcut:end-capture', endShortcutCapture, true);
  handle('settings:save', async (value: unknown) => {
    idle();
    const patch = validateSettings(value, settings);
    const previous = settings.hotkey;
    const previousWindowSize = settings.windowSize;
    const changed = patch.hotkey !== previous || !hotkeyRegistered;
    if (changed && !desktop.registerShortcut(patch.hotkey, toggle)) throw new Error('Сочетание занято другим приложением. Выберите другое.');
    const next = { ...settings, ...patch };
    try { await atomicJson(settingsPath, next); }
    catch (error) { if (changed) desktop.unregisterShortcut(patch.hotkey); throw error; }
    if (changed && previous !== patch.hotkey) desktop.unregisterShortcut(previous);
    hotkeyRegistered = true;
    settings = next;
    overlay?.setPosition(settings.indicatorPosition);
    overlay?.setMode(settings.overlayMode);
    overlay?.setLanguage(settings.appLanguage);
    if (window && !window.isDestroyed() && settings.windowSize !== previousWindowSize) {
      const [width, height] = settings.windowSize === 'medium' ? [920, 700] : [780, 600];
      window.setContentSize(width, height);
      window.center();
    }
    syncStartup(); syncTray();
    await history.applyPolicy(settings.historyLimit, settings.historyRetention);
    if (capturingShortcut) {
      capturingShortcut = false;
      clearTimeout(captureTimer);
      window?.webContents.send('shortcut:capture-ended');
    }
  }, true);
  handle('catalog:refresh', () => models.refresh(), true);
  handle('models:download', async (value: unknown) => {
    idle(); const id = safeId(value);
    const model = models.catalog.models.find(m => m.id === id);
    if (!model || !engines.has(model.engine)) throw new Error('Движок этой модели пока не поддерживается.');
    await models.start(id);
    if (!models.installed.has(id) || models.downloads.get(id)?.phase !== 'complete') return;
    const activation = mutations.then(async () => {
      const next = { ...settings, selectedModelId: id, language: languageForModel(model, settings.language) };
      await atomicJson(settingsPath, next); settings = next;
    });
    mutations = activation.then(() => undefined, () => undefined);
    await activation;
  });
  handle('models:cancel', (value: unknown) => models.cancel(safeId(value)));
  handle('models:delete', async (value: unknown) => {
    idle(); const id = safeId(value);
    await models.remove(id);
    if (settings.selectedModelId === id) { settings = { ...settings, selectedModelId: null }; await atomicJson(settingsPath, settings); }
  }, true);
  handle('models:select', async (value: unknown) => {
    idle(); const id = safeId(value); const item = models.installed.get(id);
    if (!item || !engines.has(item.model.engine)) throw new Error('Сначала скачайте поддерживаемую модель.');
    const next = { ...settings, selectedModelId: id, language: languageForModel(item.model, settings.language) }; await atomicJson(settingsPath, next); settings = next;
  }, true);
  handle('models:open', async () => { const error = await shell.openPath(models.root); if (error) throw new Error(error); });
  handle('models:license', async (id: unknown) => {
    const model = models.catalog.models.find(item => item.id === safeId(id));
    if (!model) throw new Error('Модель не найдена в каталоге.');
    await shell.openExternal(model.licenseUrl);
  });
  handle('app:open-data', async () => { const error = await shell.openPath(app.getPath('userData')); if (error) throw new Error(error); });
  handle('app:open-licenses', async () => {
    const path = app.isPackaged ? join(process.resourcesPath, 'licenses', 'THIRD-PARTY-NOTICES.md') : join(app.getAppPath(), 'THIRD-PARTY-NOTICES.md');
    if (!(await stat(path).catch(() => null))?.isFile()) throw new Error('Файл сторонних лицензий не найден. Переустановите Vokeyra.');
    shell.showItemInFolder(path);
  });
  handle('app:open-github', () => shell.openExternal('https://github.com/AKDworks/Vokeyra'));
  handle('app:check-updates', () => checkForUpdates(app.getVersion()));
  handle('app:open-latest-release', () => shell.openExternal(latestReleaseUrl));
  handle('history:open', async () => { const error = await shell.openPath(history.recordingsPath); if (error) throw new Error(error); });
  handle('history:audio', (id: unknown) => history.audio(safeId(id)));
  handle('history:favorite', async (id: unknown) => {
    await history.favorite(safeId(id));
    await history.applyPolicy(settings.historyLimit, settings.historyRetention);
  }, true);
  handle('history:retranscribe', async (value: unknown) => {
    const entryId = safeId(value);
    const wav = await history.audio(entryId);
    const id = await beginRecording();
    return transcribeRecording(id, wav, entryId);
  });
  handle('history:delete', (id: unknown) => {
    idle();
    if (typeof id !== 'string') throw new Error('Некорректная запись истории.');
    return history.remove(id);
  }, true);
  handle('history:clear', () => { idle(); return history.clear(); }, true);
  ipcMain.on('recording:level', (event, id: unknown, level: unknown, seconds: unknown) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !trusted(event.senderFrame.url)) return;
    if (!recording || recording.id !== id || recording.transcribing || typeof level !== 'number' || !Number.isFinite(level) || typeof seconds !== 'number' || !Number.isFinite(seconds)) return;
    overlay?.update({ phase: 'recording', level: Math.max(0, Math.min(1, level)), seconds: Math.max(0, Math.min(300, seconds)) });
  });
  async function beginRecording(): Promise<string> {
    idle();
    const attempt = ++recordingGeneration;
    if (capturingShortcut) throw new Error('Сначала завершите назначение клавиши.');
    const id = settings.selectedModelId;
    if (!id || !models.installed.has(id)) throw new Error('Скачайте и выберите модель во вкладке «Модели».');
    if ([...models.downloads.values()].some(d => d.id === id && ['downloading', 'verifying'].includes(d.phase))) throw new Error('Дождитесь обновления выбранной модели.');
    if (!await engineReady()) throw new Error('Встроенный движок модели недоступен. Переустановите Vokeyra.');
    if (attempt !== recordingGeneration) throw new Error('Запись отменена.');
    recording = { id: randomUUID(), modelId: id, controller: new AbortController(), transcribing: false };
    overlay?.update({ phase: 'starting', level: 0, seconds: 0 });
    overlay?.show();
    return recording.id;
  }
  handle('recording:begin', beginRecording, true);
  handle('recording:prepare-audio', async (id: unknown) => {
    const job = recording;
    if (!job || job.id !== id || job.transcribing || job.controller.signal.aborted) throw new Error('Запись уже завершена.');
    if (settings.muteWhileRecording) await desktop.muteAudio();
    if (recording !== job || job.controller.signal.aborted) { await desktop.restoreAudio(); throw new Error('Запись отменена.'); }
  });
  handle('recording:finish-audio', async (id: unknown) => {
    if (recording?.id === id) await desktop.restoreAudio();
  });
  handle('recording:cancel', async () => {
    ++recordingGeneration;
    recording?.controller.abort();
    if (!recording?.transcribing) recording = null;
    overlay?.hide();
    await desktop.restoreAudio();
  });
  async function transcribeRecording(id: unknown, wav: unknown, entryId?: string): Promise<string> {
    const job = recording;
    if (!job || job.id !== id || job.transcribing) throw new Error('Запись уже завершена.');
    let directory: string | undefined;
    job.transcribing = true;
    overlay?.update({ phase: 'transcribing', level: 0, seconds: 0 });
    try {
      await desktop.restoreAudio();
      validateWav(wav as ArrayBuffer);
      const fromHistory = !!entryId;
      const installed = models.installed.get(job.modelId)!;
      job.controller.signal.throwIfAborted();
      if (!entryId) entryId = await history.addRecording(wav as ArrayBuffer, installed.model.name);
      else await history.update(entryId, { status: 'pending' });
      directory = await mkdtemp(join(recordingsPath, 'recording-'));
      const wavPath = join(directory, 'audio.wav');
      await writeFile(wavPath, Buffer.from(voiceWav(wav as ArrayBuffer)));
      const rawText = await engines.get(installed.model.engine).transcribe({ executable: whisperExecutable(),
        modelPath: models.filePath(installed.model), wavPath, outputPrefix: join(directory, 'result'),
        language: settings.language, vocabulary: settings.customVocabulary, signal: job.controller.signal });
      const text = prepareText(rawText);
      job.controller.signal.throwIfAborted();
      await history.update(entryId, { text: text.slice(0, 100_000), modelName: installed.model.name, status: 'complete' });
      if (text) {
        if (fromHistory) desktop.copyText(text);
        else await desktop.deliverText(text, settings);
      }
      await history.applyPolicy(settings.historyLimit, settings.historyRetention);
      return text;
    } catch (error) {
      if (entryId) await history.update(entryId, { status: 'failed' }).catch(console.error);
      throw error;
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
      if (recording === job) recording = null;
      overlay?.hide();
    }
  }
  handle('recording:transcribe', transcribeRecording);
  handle('clipboard:copy', (value: unknown) => {
    if (typeof value !== 'string' || value.length > 100_000) throw new Error('Некорректный текст.');
    desktop.copyText(value);
  });
}
async function start(): Promise<void> {
  await desktop.initialize(() => {
    shortcutDown = false;
    if (heldRecording) { heldRecording = false; window?.webContents.send('recording:hold', false); }
  }, error => {
    shortcutDown = false;
    recording?.controller.abort();
    window?.webContents.send('recording:cancel-request');
    if (!quitting) dialog.showErrorBox('Vokeyra: системный модуль', error.message);
  });
  const root = app.getPath('userData');
  settingsPath = join(root, 'settings.json');
  recordingsPath = join(root, 'transcription-tmp');
  history = new HistoryStore(join(root, 'history.json'));
  await history.init();
  // Only our dedicated scratch directory is cleared, never arbitrary temp files.
  await rm(recordingsPath, { recursive: true, force: true });
  await mkdir(recordingsPath, { recursive: true });
  try {
    const saved = await readJson(settingsPath) as Settings;
    const migrated = { ...saved, historyLimit: typeof saved.historyLimit === 'number' ? Math.min(100, saved.historyLimit) : saved.historyLimit };
    settings = { ...defaults, ...validateSettings(migrated),
      selectedModelId: typeof saved.selectedModelId === 'string' ? safeId(saved.selectedModelId) : null };
  } catch { /* A broken settings file must not prevent startup. */ }
  await history.applyPolicy(settings.historyLimit, settings.historyRetention);
  historyCleanupTimer = setInterval(() => {
    void history.applyPolicy(settings.historyLimit, settings.historyRetention).catch(console.error);
  }, 15 * 60_000);
  models = new ModelManager(join(root, 'models'), join(root, 'models.json'), state => {
    if (window && !window.isDestroyed()) window.webContents.send('models:progress', state);
  });
  await models.init(app.isPackaged ? join(process.resourcesPath, 'models.json') : join(app.getAppPath(), 'resources/models.json'));
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(contents === window?.webContents && trusted(contents.getURL()) && permission === 'media' && 'mediaTypes' in details && details.mediaTypes?.every(t => t === 'audio') === true);
  });
  session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) =>
    contents === window?.webContents && trusted(contents.getURL()) && permission === 'media' && details.mediaType === 'audio');
  registerIpc();
  nativeTheme.themeSource = 'dark';
  const iconPath = app.isPackaged ? join(process.resourcesPath, 'app-icon.ico') : join(app.getAppPath(), 'favicon/favicon.ico');
  appIconPath = iconPath;
  const [windowWidth, windowHeight] = settings.windowSize === 'medium' ? [920, 700] : [780, 600];
  window = new BrowserWindow({ width: windowWidth, height: windowHeight, useContentSize: true, resizable: false, maximizable: false, fullscreenable: false,
    icon: nativeImage.createFromPath(iconPath).resize({ width: 256, height: 256 }),
    show: false, autoHideMenuBar: true, title: 'Vokeyra', backgroundColor: '#292a29',
    webPreferences: { preload: join(__dirname, '../preload/index.cjs'), contextIsolation: true, sandbox: true,
      nodeIntegration: false, webSecurity: true, backgroundThrottling: false, spellcheck: false, autoplayPolicy: 'no-user-gesture-required' } });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  const resetRenderer = () => { ++recordingGeneration; recording?.controller.abort(); if (!recording?.transcribing) recording = null; overlay?.hide(); endShortcutCapture(); void desktop.restoreAudio().catch(console.error); };
  window.webContents.on('render-process-gone', resetRenderer);
  window.webContents.on('did-start-loading', resetRenderer);
  window.on('blur', endShortcutCapture);
  window.once('ready-to-show', () => { if (!settings.hideOnStartup && !process.argv.includes('--hidden')) window?.show(); });
  window.on('close', event => { if (!quitting && settings.showTrayIcon) { event.preventDefault(); window?.hide(); } });
  window.on('closed', () => { window = null; overlay?.destroy(); if (!settings.showTrayIcon) app.quit(); });
  overlay = new RecordingOverlay(overlayUrl(devUrl), () => {
    recording?.controller.abort();
    void desktop.restoreAudio().catch(console.error);
    overlay?.hide();
    window?.webContents.send('recording:cancel-request');
  });
  await overlay.load();
  overlay.setPosition(settings.indicatorPosition);
  overlay.setMode(settings.overlayMode);
  overlay.setLanguage(settings.appLanguage);
  syncStartup(); syncTray();
  try { hotkeyRegistered = desktop.registerShortcut(settings.hotkey, toggle); } catch { hotkeyRegistered = false; }
  await window.loadURL(devUrl ?? rendererUrl);
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { window?.restore(); window?.show(); window?.focus(); });
  app.whenReady().then(start).catch(error => { dialog.showErrorBox('Vokeyra: ошибка запуска', String(error)); app.quit(); });
  app.on('window-all-closed', () => { if (!settings.showTrayIcon) app.quit(); });
  app.on('before-quit', event => {
    if (cleaned) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    globalShortcut.unregisterAll();
    clearTimeout(captureTimer);
    clearInterval(historyCleanupTimer);
    overlay?.hide();
    tray?.destroy(); tray = undefined;
    recording?.controller.abort();
    void Promise.allSettled([models?.shutdown(), desktop.close(), ...transcriptionTasks]).then(async () => {
      if (recordingsPath) await rm(recordingsPath, { recursive: true, force: true }).catch(() => {});
    }).finally(() => { cleaned = true; app.quit(); });
  });
}
