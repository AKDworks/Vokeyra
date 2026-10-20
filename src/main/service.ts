import { config, host, hostEvents, emit, route, serve } from './host';
import { join } from 'node:path';

import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { atomicJson, readJson } from './storage';
import { ModelManager } from './models';
import { desktop } from './platform/desktop';
import { EngineRegistry } from './engines/types';
import { WhisperCppEngine } from './engines/whisper';
import { GigaAmEngine } from './engines/gigaam';
import { SherpaEngine } from './engines/sherpa';
import { sherpaModels, type SherpaEngineId } from '../shared/sherpa-models';
import { encodeWav, validateWav } from '../shared/wav';
import type { Settings, Snapshot } from '../shared/contracts';
import { HistoryStore } from './history';
import { RecordingOverlay } from './tauri-overlay';
import { defaultPreferences, validatePreferences } from '../shared/preferences';
import { prepareTranscript } from '../shared/transcript';
import type { AppUpdateState } from '../shared/contracts';

const defaults: Settings = { ...defaultPreferences, selectedModelId: null };
const modelIdleTimeout = (value: Settings['modelUnloadDelay']): number | null => ({
  never: null, immediate: 0, '15s': 15_000, '2m': 2 * 60_000, '5m': 5 * 60_000,
  '10m': 10 * 60_000, '15m': 15 * 60_000,
})[value];
const engines = new EngineRegistry();
engines.register(new WhisperCppEngine());
engines.register(new GigaAmEngine());
engines.register(new GigaAmEngine('gigaam-multilingual-ctc', ['ru', 'en', 'kk', 'ky', 'uz']));
for (const id of Object.keys(sherpaModels) as SherpaEngineId[]) engines.register(new SherpaEngine(id));
let settings = { ...defaults };

let models: ModelManager;
let history: HistoryStore;
let overlay: RecordingOverlay | undefined;
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
let startupReady: Promise<void> = Promise.resolve();
let updateBusy = false;
let updateState: AppUpdateState = { phase: 'idle', currentVersion: config.version };
let shortcutDown = false;
let heldRecording = false;
async function syncDesktop(): Promise<void> { await host('settings:apply', settings); }
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
  if (capturingShortcut || shortcutDown) return;
  shortcutDown = true;
  if (process.platform === 'win32') void desktop.watchRelease(settings.hotkey).catch(error => {
    shortcutDown = false;
    emit('recording:cancel-request');
    emit('service:error', String(error));
  });
  if (settings.pushToTalk) { heldRecording = true; emit('recording:hold', true); }
  else emit('recording:toggle');
};
async function endShortcutCapture(): Promise<void> {
  if (!capturingShortcut) return;
  capturingShortcut = false;
  clearTimeout(captureTimer);
  try { hotkeyRegistered = await desktop.registerShortcut(settings.hotkey, toggle); } catch { hotkeyRegistered = false; }
  emit('shortcut:capture-ended');
}
const idle = () => {
  if (recording) throw new Error('Сначала завершите запись или распознавание.');
  if (updateBusy) throw new Error('Дождитесь завершения обновления Vokeyra.');
};
const safeId = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(value)) throw new Error('Некорректный ID.');
  return value;
};
function validateSettings(value: unknown, base = defaultPreferences) {
  const result = validatePreferences(value, base);
  const caps = desktop.capabilities();
  if (!caps.muteAudio && result.muteWhileRecording) throw new Error('Отключение системного звука недоступно в вашей системе.');
  if (!caps.pushToTalk && result.pushToTalk) throw new Error('Удержание клавиши недоступно в вашей системе.');
  return result;
}
function whisperExecutable(): string {
  return join(config.resourcePath, 'whisper', process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli');
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
  await startupReady;
  return { desktop: desktop.capabilities(), settings, models: models.views(id => engines.has(id)), downloads: [...models.downloads.values()],
    modelsPath: models.root, engineReady: await engineReady(), hotkeyRegistered, busy: !!recording,
    history: history.entries, dataPath: config.dataPath, appVersion: config.version };
}
// Short mutations are serialized so disk state and shortcuts cannot race each other.
let mutations = Promise.resolve();
function handle(channel: string, fn: (...args: any[]) => unknown, serialize = false): void {
  route(channel, (...args) => {
    if (!serialize) {
      if (channel === 'recording:transcribe' || channel === 'history:retranscribe') {
        const task = Promise.resolve(fn(...args)); transcriptionTasks.add(task);
        return task.finally(() => { transcriptionTasks.delete(task); });
      }
      return fn(...args);
    }
    const task = mutations.then(() => fn(...args));
    mutations = task.then(() => undefined, () => undefined); return task;
  });
}

async function persistSettings(next: Settings, allowUnavailableHotkey = false): Promise<void> {
  const previousHotkey = settings.hotkey;
  const previousHotkeyRegistered = hotkeyRegistered;

  const needsRegistration = next.hotkey !== previousHotkey || !hotkeyRegistered;
  let nextHotkeyRegistered = hotkeyRegistered;
  if (needsRegistration) {
    nextHotkeyRegistered = await desktop.registerShortcut(next.hotkey, toggle);
    if (!nextHotkeyRegistered && !allowUnavailableHotkey && desktop.capabilities().globalShortcut) {
      if (desktop.capabilities().session === 'wayland') throw new Error('Не удалось применить горячую клавишу. Проверьте конфигурацию и права swhkd.');
      throw new Error('Сочетание занято другим приложением. Выберите другое.');
    }
  }
  try { await atomicJson(settingsPath, next); }
  catch (error) {
    if (needsRegistration && nextHotkeyRegistered && next.hotkey !== previousHotkey) await desktop.unregisterShortcut(next.hotkey);
    throw error;
  }
  if (needsRegistration && previousHotkeyRegistered && previousHotkey !== next.hotkey) await desktop.unregisterShortcut(previousHotkey);
  hotkeyRegistered = nextHotkeyRegistered;
  settings = next;
  engines.setIdleTimeout(modelIdleTimeout(settings.modelUnloadDelay));
  overlay?.setPosition(settings.indicatorPosition);
  overlay?.setMode(settings.overlayMode);
  overlay?.setLanguage(settings.appLanguage);
  await syncDesktop();
  await history.applyPolicy(settings.historyLimit, settings.historyRetention);
  if (capturingShortcut) {
    capturingShortcut = false;
    clearTimeout(captureTimer);
    emit('shortcut:capture-ended');
  }
}
function registerIpc(): void {
  handle('app:snapshot', snapshot);
  handle('shortcut:begin-capture', async () => {
    idle();
    if (!await host<boolean>('window:focused')) throw new Error('Сначала выберите окно Vokeyra.');
    capturingShortcut = true;
    await desktop.unregisterShortcut(settings.hotkey);
    hotkeyRegistered = false;
    clearTimeout(captureTimer);
    captureTimer = setTimeout(endShortcutCapture, 30_000);
  }, true);
  handle('shortcut:end-capture', endShortcutCapture, true);
  handle('settings:save', async (value: unknown) => {
    idle();
    const patch = validateSettings(value, settings);
    await persistSettings({ ...settings, ...patch });
  }, true);
  handle('settings:reset', async () => {
    idle();
    await engines.unloadAll();
    await persistSettings({ ...defaultPreferences, selectedModelId: null }, true);
  }, true);
  handle('catalog:refresh', () => models.refresh(), true);
  handle('models:download', async (value: unknown) => {
    idle(); const id = safeId(value);
    const model = models.catalog.models.find(m => m.id === id);
    if (!model || !engines.has(model.engine)) throw new Error('Движок этой модели пока не поддерживается.');
    await engines.unload(model.engine);
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
  handle('models:delete-all', async () => {
    idle();
    await engines.unloadAll();
    const removed = await models.removeAll();
    if (settings.selectedModelId !== null) {
      settings = { ...settings, selectedModelId: null };
      await atomicJson(settingsPath, settings);
    }
    return removed;
  }, true);
  handle('models:delete', async (value: unknown) => {
    idle(); const id = safeId(value);
    const installed = models.installed.get(id);
    if (installed) await engines.unload(installed.model.engine);
    await models.remove(id);
    if (settings.selectedModelId === id) { settings = { ...settings, selectedModelId: null }; await atomicJson(settingsPath, settings); }
  }, true);
  handle('models:select', async (value: unknown) => {
    idle(); const id = safeId(value); const item = models.installed.get(id);
    if (!item || !engines.has(item.model.engine)) throw new Error('Сначала скачайте поддерживаемую модель.');
    const next = { ...settings, selectedModelId: id, language: languageForModel(item.model, settings.language) }; await atomicJson(settingsPath, next); settings = next;
  }, true);
  handle('models:open', async () => { await host('path:open', models.root); });
  handle('models:license', async (id: unknown) => {
    const model = models.catalog.models.find(item => item.id === safeId(id));
    if (!model) throw new Error('Модель не найдена в каталоге.');
    await host('url:open', model.licenseUrl);
  });
  handle('app:open-data', async () => { await host('path:open', config.dataPath); });
  handle('app:open-licenses', async () => {
    const path = join(config.resourcePath, 'licenses', 'THIRD-PARTY-NOTICES.md');
    if (!(await stat(path).catch(() => null))?.isFile()) throw new Error('Файл сторонних лицензий не найден. Переустановите Vokeyra.');
    await host('path:reveal', path);
  });
  handle('app:open-github', () => host('url:open', 'https://github.com/AKDworks/Vokeyra'));
  handle('app:start-update', async () => {
    idle();
    if ([...models.downloads.values()].some(item => ['downloading', 'verifying'].includes(item.phase))) {
      throw new Error('Дождитесь завершения загрузки модели.');
    }
    if (!config.packaged) throw new Error('Автоматическое обновление доступно только в установленной версии Vokeyra.');
    updateBusy = true;
    try { return await host<AppUpdateState>('update:check'); }
    finally { updateBusy = false; }
  });
  handle('history:open', async () => { await host('path:open', history.recordingsPath); });
  handle('history:audio', async (id: unknown) => Buffer.from(await history.audio(safeId(id))).toString('base64'));
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
  handle('recording:level', (id: unknown, level: unknown, seconds: unknown) => {
    if (!recording || recording.id !== id || recording.transcribing || typeof level !== 'number' || !Number.isFinite(level) || typeof seconds !== 'number' || !Number.isFinite(seconds)) return;
    overlay?.update({ phase: 'recording', level: Math.max(0, Math.min(1, level)), seconds: Math.max(0, Math.min(300, seconds)) });
  });
  async function beginRecording(): Promise<string> {
    await startupReady;
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
      const text = prepareTranscript(rawText, settings);
      job.controller.signal.throwIfAborted();
      await history.update(entryId, { text: text.slice(0, 100_000), modelName: installed.model.name, status: 'complete' });
      if (text) {
        if (fromHistory) await desktop.copyText(text);
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
  handle('recording:transcribe', (id: unknown, encoded: unknown) => {
    if (typeof encoded !== 'string' || encoded.length > 13_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('Некорректная запись.');
    return transcribeRecording(id, Uint8Array.from(Buffer.from(encoded, 'base64')).buffer);
  });
  handle('overlay:state', () => overlay?.state);
  handle('overlay:cancel', async () => { recording?.controller.abort(); overlay?.hide(); await desktop.restoreAudio(); emit('recording:cancel-request'); });
  handle('clipboard:copy', async (value: unknown) => {
    if (typeof value !== 'string' || value.length > 100_000) throw new Error('Некорректный текст.');
    await desktop.copyText(value);
  });
}
async function start(): Promise<void> {
  const root = config.dataPath;
  settingsPath = join(root, 'settings.json');
  recordingsPath = join(root, 'transcription-tmp');
  // Discover Linux tools before validating saved preferences against capabilities.
  const initializeDesktop = desktop.initialize(() => {
    shortcutDown = false;
    if (heldRecording) { heldRecording = false; emit('recording:hold', false); }
  }, error => {
    shortcutDown = false;
    recording?.controller.abort();
    emit('recording:cancel-request');
    if (!quitting) emit('service:error', error.message);
  });
  await initializeDesktop;
  try {
    const saved = await readJson(settingsPath) as Settings;
    const migrated = { ...saved, ...(typeof saved.historyLimit === 'number' ? { historyLimit: Math.min(100, saved.historyLimit) } : {}) };
    settings = { ...defaults, ...validateSettings(migrated),
      selectedModelId: typeof saved.selectedModelId === 'string' ? safeId(saved.selectedModelId) : null };
  } catch {}
  engines.setIdleTimeout(modelIdleTimeout(settings.modelUnloadDelay));
  history = new HistoryStore(join(root, 'history.json'));
  models = new ModelManager(join(root, 'models'), join(root, 'models.json'), state => {
    emit('models:progress', state);
  });
  const initializeHistory = history.init().then(() => history.applyPolicy(settings.historyLimit, settings.historyRetention));
  const initializeModels = models.init(join(config.resourcePath, 'models.json'));
  // Only our dedicated scratch directory is cleared, never arbitrary temp files.
  const initializeScratch = rm(recordingsPath, { recursive: true, force: true })
    .then(() => mkdir(recordingsPath, { recursive: true }));
  const coreReady = Promise.all([initializeDesktop, initializeHistory, initializeModels, initializeScratch]);
  registerIpc();
  hostEvents.on('shortcut:toggle', () => {
    if (capturingShortcut || quitting) return;
    shortcutDown = false;
    heldRecording = false;
    emit('recording:toggle');
  });
  hostEvents.on('shortcut:pressed', toggle);
  hostEvents.on('shortcut:released', () => {
    if (process.platform === 'win32') return; // Windows tracks modifier release through its native helper.
    shortcutDown = false;
    if (heldRecording) { heldRecording = false; emit('recording:hold', false); }
  });
  hostEvents.on('shortcut:cancel', () => {
    shortcutDown = false;
    heldRecording = false;
    recording?.controller.abort();
    overlay?.hide();
    void desktop.restoreAudio();
    emit('recording:cancel-request');
  });
  hostEvents.on('window:blur', () => { void endShortcutCapture().catch(console.error); });
  hostEvents.on('app:update-state', (state: AppUpdateState) => { updateState = state; updateBusy = ['checking', 'available', 'downloading', 'installing'].includes(state.phase); emit('app:update-state', state); });
  startupReady = coreReady.then(async () => {
    historyCleanupTimer = setInterval(() => { void history.applyPolicy(settings.historyLimit, settings.historyRetention).catch(console.error); }, 15 * 60_000);
    overlay = new RecordingOverlay();
    overlay.setPosition(settings.indicatorPosition); overlay.setMode(settings.overlayMode); overlay.setLanguage(settings.appLanguage);
    await syncDesktop();
    try { hotkeyRegistered = await desktop.registerShortcut(settings.hotkey, toggle); } catch { hotkeyRegistered = false; }
  });
  await startupReady;
}
async function cleanupApplication(): Promise<void> {
  if (cleaned) return;
  quitting = true;
  await host('shortcut:clear').catch(console.error);
  clearTimeout(captureTimer);
  clearInterval(historyCleanupTimer);
  overlay?.hide();

  recording?.controller.abort();
  await Promise.allSettled([models?.shutdown(), engines.unloadAll(), desktop.close(), ...transcriptionTasks]);
  if (recordingsPath) await rm(recordingsPath, { recursive: true, force: true }).catch(() => {});
  cleaned = true;
}
serve(start, cleanupApplication);
