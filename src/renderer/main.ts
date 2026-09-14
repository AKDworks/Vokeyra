import type { DownloadState, Preferences, Snapshot } from '../shared/contracts';
import { MicrophoneRecorder } from './recorder';
import { acceleratorFromEvent, prettyHotkey } from '../shared/hotkey';
import { CustomSelect } from './custom-select';
import { setupInfoTooltips } from './info-tooltip';
import { setIcon, setupIcons } from './icons';
import { HistoryView } from './history-view';
import { ModelsView } from './models-view';
import brandLogo from '../../logo/vokeyra-logo.png?url';
import { SoundSettings } from './sound-settings';
import { playFeedback } from './audio-feedback';
import { setAppLanguage } from './i18n';

(document.getElementById('brand-logo') as HTMLImageElement).src = brandLogo;
setupIcons();
setupInfoTooltips();

const api = window.vokeyra;
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let snapshot: Snapshot;
let mode: 'idle' | 'starting' | 'recording' | 'transcribing' = 'idle';
let recorder: MicrophoneRecorder | undefined;
let sessionId = '';
let generation = 0;
let startedAt = 0;
let recordingTimer: ReturnType<typeof setInterval> | undefined;
let initialized = false;
let capturingHotkey = false;
let savingHotkey = false;
let heldSession = false;
const downloads = new Map<string, DownloadState>();
const appLanguageSelect = new CustomSelect(el<HTMLButtonElement>('app-language'), el('app-language-options'), [
  { value: 'ru', label: 'Русский' }, { value: 'en', label: 'English' },
], value => void savePreferences({ appLanguage: value as Preferences['appLanguage'] }).catch(report));
const languageSelect = new CustomSelect(el<HTMLButtonElement>('language'), el('language-options'), [
  { value: 'auto', label: 'Определять автоматически' }, { value: 'ru', label: 'Русский' },
  { value: 'en', label: 'English' }, { value: 'kk', label: 'Қазақша' },
  { value: 'uk', label: 'Українська' }, { value: 'de', label: 'Deutsch' },
  { value: 'fr', label: 'Français' }, { value: 'es', label: 'Español' },
  { value: 'bg', label: 'Български' }, { value: 'hr', label: 'Hrvatski' }, { value: 'cs', label: 'Čeština' },
  { value: 'da', label: 'Dansk' }, { value: 'nl', label: 'Nederlands' }, { value: 'et', label: 'Eesti' },
  { value: 'fi', label: 'Suomi' }, { value: 'el', label: 'Ελληνικά' }, { value: 'hu', label: 'Magyar' },
  { value: 'it', label: 'Italiano' }, { value: 'lv', label: 'Latviešu' }, { value: 'lt', label: 'Lietuvių' },
  { value: 'mt', label: 'Malti' }, { value: 'pl', label: 'Polski' }, { value: 'pt', label: 'Português' },
  { value: 'ro', label: 'Română' }, { value: 'sk', label: 'Slovenčina' }, { value: 'sl', label: 'Slovenščina' },
  { value: 'sv', label: 'Svenska' }, { value: 'ky', label: 'Кыргызча' }, { value: 'uz', label: "O‘zbekcha" },
], value => {
  languageSelect.setDisabled(true);
  void savePreferences({ language: value }).then(() => notice('Язык сохранён.')).catch(error => {
    languageSelect.setValue(snapshot.settings.language); report(error);
  }).finally(() => languageSelect.setDisabled(mode !== 'idle' || capturingHotkey));
});
const settingSelects = {
  overlayMode: new CustomSelect(el<HTMLButtonElement>('overlay-mode'), el('overlay-mode-options'), [
    { value: 'none', label: 'Нет' }, { value: 'minimal', label: 'Минимальное' }, { value: 'realtime', label: 'В реальном времени' },
  ], value => void savePreferences({ overlayMode: value as Preferences['overlayMode'] }).catch(report)),
  indicatorPosition: new CustomSelect(el<HTMLButtonElement>('indicator-position'), el('indicator-position-options'), [
    { value: 'bottom', label: 'Снизу' }, { value: 'top', label: 'Сверху' },
  ], value => void savePreferences({ indicatorPosition: value as Preferences['indicatorPosition'] }).catch(report)),
  modelUnloadDelay: new CustomSelect(el<HTMLButtonElement>('model-unload'), el('model-unload-options'), [
    { value: 'never', label: 'Никогда' }, { value: 'immediate', label: 'Немедленно' },
    { value: '2m', label: 'Через 2 минуты' }, { value: '5m', label: 'Через 5 минут' },
    { value: '10m', label: 'Через 10 минут' }, { value: '15m', label: 'Через 15 минут' },
    { value: '15s', label: 'Через 15 секунд (отладка)' },
  ], value => void savePreferences({ modelUnloadDelay: value as Preferences['modelUnloadDelay'] }).catch(report)),
  windowSize: new CustomSelect(el<HTMLButtonElement>('window-size'), el('window-size-options'), [
    { value: 'compact', label: 'Компактный · 780 × 600' }, { value: 'medium', label: 'Средний · 920 × 700' },
  ], value => void savePreferences({ windowSize: value as Preferences['windowSize'] }).catch(report)),
  pasteMethod: new CustomSelect(el<HTMLButtonElement>('paste-method'), el('paste-method-options'), [
    { value: 'ctrl-v', label: 'Буфер обмена (Ctrl+V)' }, { value: 'direct', label: 'Прямой' },
    { value: 'none', label: 'Нет' }, { value: 'ctrl-shift-v', label: 'Буфер обмена (Ctrl+Shift+V)' },
    { value: 'shift-insert', label: 'Буфер обмена (Shift+Insert)' },
  ], value => void savePreferences({ pasteMethod: value as Preferences['pasteMethod'] }).catch(report)),
  clipboardHandling: new CustomSelect(el<HTMLButtonElement>('clipboard-handling'), el('clipboard-handling-options'), [
    { value: 'restore', label: 'Не изменять буфер обмена' }, { value: 'keep', label: 'Сохранить распознанный текст' },
  ], value => void savePreferences({ clipboardHandling: value as Preferences['clipboardHandling'] }).catch(report)),
  autoSubmit: new CustomSelect(el<HTMLButtonElement>('auto-submit'), el('auto-submit-options'), [
    { value: 'off', label: 'Выкл.' }, { value: 'enter', label: 'Enter' }, { value: 'ctrl-enter', label: 'Ctrl+Enter' },
  ], value => void savePreferences({ autoSubmit: value as Preferences['autoSubmit'] }).catch(report)),
  historyRetention: new CustomSelect(el<HTMLButtonElement>('auto-delete-history'), el('auto-delete-history-options'), [
    { value: 'never', label: 'Никогда' }, { value: 'limit', label: 'Хранить последние 5' },
    { value: '3d', label: 'Через 3 дня' }, { value: '2w', label: 'Через 2 недели' }, { value: '3m', label: 'Через 3 месяца' },
  ], value => void savePreferences({ historyRetention: value as Preferences['historyRetention'] }).catch(report)),
};
const settingSelectList = Object.values(settingSelects);
const switchSettings: Array<[string, keyof Pick<Preferences, 'hideOnStartup' | 'launchAtStartup' | 'showTrayIcon' |
  'voiceActivityDetection' | 'punctuation' | 'removeFillerWords' | 'appendSpace'>]> = [
  ['hide-startup', 'hideOnStartup'], ['launch-startup', 'launchAtStartup'], ['show-tray', 'showTrayIcon'],
  ['vad', 'voiceActivityDetection'], ['punctuation', 'punctuation'], ['remove-fillers', 'removeFillerWords'], ['append-space', 'appendSpace'],
];
for (const [id, key] of switchSettings) el<HTMLButtonElement>(id).onclick = () => {
  void savePreferences({ [key]: !snapshot.settings[key] }).catch(report);
};
const soundSettings = new SoundSettings(savePreferences, report);

const modelsView = new ModelsView(api, () => refresh(true));
const historyView = new HistoryView(el('history-list'), api, refresh, async id => {
  if (mode !== 'idle' || capturingHotkey) return;
  historyView.stop(); mode = 'transcribing'; updateControls();
  try { await api.retranscribeHistory(id); }
  finally { mode = 'idle'; updateControls(); await refresh(); }
});

function notice(message: string, error = false): void {
  el('notice-text').textContent = message;
  el('notice').hidden = true; // Retain diagnostics in code; no visible notifications for now.
  el('notice').classList.toggle('error', error);
}
el('dismiss-notice').onclick = () => notice('');
function report(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  notice(message.replace(/^Error invoking remote method '[^']+': Error: /, ''), true);
}
async function action(operation: () => Promise<unknown>, message?: string): Promise<void> {
  try { await operation(); await refresh(); if (message) notice(message); } catch (error) { report(error); }
}
function showTab(name: string): void {
  historyView.stop();
  modelsView.close();
  appLanguageSelect.close();
  languageSelect.close();
  soundSettings.close();
  settingSelectList.forEach(select => select.close());
  if (capturingHotkey) void api.endShortcutCapture().catch(report);
  document.querySelectorAll<HTMLElement>('.tab').forEach(tab => { tab.hidden = tab.id !== name; });
  document.querySelectorAll<HTMLButtonElement>('nav button').forEach(button => {
    button.classList.toggle('active', button.dataset.tab === name);
    if (button.dataset.tab === name) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
}
document.querySelectorAll<HTMLButtonElement>('nav button').forEach(button => button.addEventListener('click', () => showTab(button.dataset.tab!)));
function updateControls(): void {
  const busy = mode !== 'idle';
  historyView.setBusy(busy || capturingHotkey);
  appLanguageSelect.setDisabled(busy || capturingHotkey);
  languageSelect.setDisabled(busy || capturingHotkey);
  soundSettings.setBusy(busy || capturingHotkey);
  settingSelectList.forEach(select => select.setDisabled(busy || capturingHotkey));
  el('cancel-recording').hidden = !busy;
  el<HTMLButtonElement>('record').disabled = capturingHotkey || mode === 'starting' || mode === 'transcribing';
  el('record').classList.toggle('recording', mode === 'recording');
  el('record').setAttribute('aria-label', mode === 'recording' ? 'Остановить запись' : 'Начать запись');
  el('record').textContent = mode === 'recording' ? 'Завершить' : mode === 'transcribing' ? 'Обработка…' : 'Начать запись';
  el('record-status').textContent = { idle: 'Готово к записи', starting: 'Подключаем микрофон…', recording: 'Идёт запись', transcribing: 'Распознаём на устройстве…' }[mode];
  document.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('#advanced input, #advanced button, #language, #hotkey').forEach(item => { item.disabled = busy || capturingHotkey; });
  if (snapshot) renderModels();
}
async function refresh(fillSettings = false): Promise<void> {
  snapshot = await api.snapshot();
  setAppLanguage(snapshot.settings.appLanguage);
  soundSettings.setValue(snapshot.settings);
  downloads.clear(); snapshot.downloads.forEach(state => downloads.set(state.id, state));
  if (!initialized || fillSettings) {
    appLanguageSelect.setValue(snapshot.settings.appLanguage);
    languageSelect.setValue(snapshot.settings.language);
    settingSelects.overlayMode.setValue(snapshot.settings.overlayMode);
    settingSelects.indicatorPosition.setValue(snapshot.settings.indicatorPosition);
    settingSelects.modelUnloadDelay.setValue(snapshot.settings.modelUnloadDelay);
    settingSelects.windowSize.setValue(snapshot.settings.windowSize);
    settingSelects.pasteMethod.setValue(snapshot.settings.pasteMethod);
    settingSelects.clipboardHandling.setValue(snapshot.settings.clipboardHandling);
    settingSelects.autoSubmit.setValue(snapshot.settings.autoSubmit);
    settingSelects.historyRetention.setOptions([
      { value: 'never', label: 'Никогда' }, { value: 'limit', label: `Хранить последние ${snapshot.settings.historyLimit}` },
      { value: '3d', label: 'Через 3 дня' }, { value: '2w', label: 'Через 2 недели' }, { value: '3m', label: 'Через 3 месяца' },
    ]);
    settingSelects.historyRetention.setValue(snapshot.settings.historyRetention);
    el<HTMLInputElement>('history-limit').value = String(snapshot.settings.historyLimit);
    for (const [id, key] of switchSettings) el(id).setAttribute('aria-checked', String(snapshot.settings[key]));
    renderDictionary();
  }
  if (!capturingHotkey) el('hotkey').textContent = prettyHotkey(snapshot.settings.hotkey);
  el('data-path').textContent = snapshot.dataPath;
  const selected = snapshot.models.find(item => item.model.id === snapshot.settings.selectedModelId && item.installed);
  el('selected-model').textContent = selected ? `${selected.installed!.model.name} · ${snapshot.settings.language === 'auto' ? 'Авто' : snapshot.settings.language.toUpperCase()}` : 'Модель не выбрана';
  if (!initialized) {
    if (!snapshot.hotkeyRegistered) notice('Горячая клавиша занята. Выберите другую на вкладке «Главное».', true);
    else if (!selected) notice('Скачайте модель во вкладке «Модели» — она выберется автоматически.');
    else if (!snapshot.engineReady) notice('Встроенный движок модели недоступен. Переустановите Vokeyra.', true);
  }
  initialized = true;
  renderModels();
  renderHistory();
}
function renderHistory(): void { historyView.render(snapshot.history); }
function renderModels(): void { if (snapshot) modelsView.update(snapshot, downloads, mode !== 'idle' || capturingHotkey); }
async function toggleRecording(fromHold = false): Promise<void> {
  if (capturingHotkey || mode === 'starting' || mode === 'transcribing') return;
  const token = ++generation;
  try {
    if (mode === 'idle') {
      historyView.stop();
      heldSession = fromHold;
      mode = 'starting'; updateControls(); notice('');
      sessionId = await api.beginRecording();
      if (token !== generation) return;
      await playFeedback('start', snapshot.settings).catch(report);
      if (token !== generation) return;
      await api.prepareRecordingAudio(sessionId);
      if (token !== generation) return;
      recorder = new MicrophoneRecorder();
      startedAt = Date.now();
      await recorder.start(() => { void toggleRecording(); }, level => {
        if (token === generation) api.recordingLevel(sessionId, level, (Date.now() - startedAt) / 1000);
      }, snapshot.settings);
      if (token !== generation) return;
      mode = 'recording'; updateControls();
      startedAt = Date.now();
      recordingTimer = setInterval(() => {
        const seconds = Math.floor((Date.now() - startedAt) / 1000);
        el('record-status').textContent = `Идёт запись · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
      }, 500);
    } else {
      mode = 'transcribing'; clearInterval(recordingTimer); updateControls();
      const wav = await recorder!.stop(); recorder = undefined;
      if (token !== generation) return;
      await api.finishRecordingAudio(sessionId);
      await playFeedback('stop', snapshot.settings).catch(report);
      if (token !== generation) return;
      const text = await api.transcribe(sessionId, wav);
      if (token !== generation) return;
      el<HTMLTextAreaElement>('transcript').value = text;
      el<HTMLButtonElement>('copy').disabled = !text;
      notice(text ? 'Текст скопирован. Вставьте его с помощью Ctrl + V.' : 'Речь не обнаружена. Попробуйте ещё раз.', !text);
      heldSession = false; mode = 'idle'; updateControls(); await refresh();
    }
  } catch (error) {
    if (token !== generation) return;
    clearInterval(recordingTimer);
    await recorder?.dispose(); recorder = undefined;
    await api.cancelRecording().catch(report); heldSession = false; mode = 'idle'; updateControls(); report(error); await refresh().catch(report);
  }
}
el('record').onclick = () => { void toggleRecording(); };
api.onToggle(() => { void toggleRecording(); });
api.onHold(pressed => {
  if (pressed) { if (mode === 'idle') void toggleRecording(true); }
  else if (heldSession) {
    if (mode === 'starting') void cancelRecording();
    else if (mode === 'recording') void toggleRecording();
  }
});
async function cancelRecording(): Promise<void> {
  try {
    ++generation; clearInterval(recordingTimer);
    heldSession = false;
    const current = recorder; recorder = undefined;
    const results = await Promise.allSettled([current?.dispose(), api.cancelRecording()]);
    // Main keeps an aborted child busy until it has actually exited.
    mode = 'idle'; updateControls(); notice('Запись отменена.');
    for (const result of results) if (result.status === 'rejected') report(result.reason);
  } catch (error) { report(error); }
}
el('cancel-recording').onclick = () => { void cancelRecording(); };
api.onCancel(() => { void cancelRecording(); });
api.onDownload(state => {
  downloads.set(state.id, state);
  if (snapshot) renderModels();
  if (['complete', 'error', 'cancelled'].includes(state.phase)) void refresh().catch(report);
});
el<HTMLTextAreaElement>('transcript').oninput = () => { el<HTMLButtonElement>('copy').disabled = !el<HTMLTextAreaElement>('transcript').value.trim(); };
el('copy').onclick = () => { void action(() => api.copyText(el<HTMLTextAreaElement>('transcript').value), 'Текст скопирован.'); };
el('open-models').onclick = () => { void action(() => api.openModelsFolder()); };
el('open-data').onclick = () => { void action(() => api.openDataFolder()); };
el('open-github').onclick = () => { void action(() => api.openGithub()); };
el('open-recordings').onclick = () => { void action(() => api.openRecordingsFolder()); };
async function savePreferences(patch: Partial<Preferences>): Promise<void> {
  await api.saveSettings(patch);
  await refresh(true);
}
function renderDictionary(): void {
  const list = el('dictionary-list');
  list.replaceChildren();
  for (const word of snapshot.settings.customVocabulary) {
    const item = document.createElement('span'); item.className = 'dictionary-chip'; item.textContent = word;
    const remove = document.createElement('button'); remove.type = 'button'; setIcon(remove, 'close'); remove.setAttribute('aria-label', `Удалить ${word}`);
    remove.onclick = () => void savePreferences({ customVocabulary: snapshot.settings.customVocabulary.filter(value => value !== word) }).catch(report);
    item.append(remove); list.append(item);
  }
  list.hidden = !list.childElementCount;
}
el<HTMLFormElement>('dictionary-form').onsubmit = event => {
  event.preventDefault();
  const input = el<HTMLInputElement>('dictionary-word'); const word = input.value.trim();
  if (!word || snapshot.settings.customVocabulary.includes(word)) return;
  void savePreferences({ customVocabulary: [...snapshot.settings.customVocabulary, word] }).then(() => { input.value = ''; }).catch(report);
};
el<HTMLInputElement>('history-limit').onchange = () => {
  const input = el<HTMLInputElement>('history-limit');
  const value = Math.max(1, Math.min(100, Math.round(Number(input.value) || snapshot.settings.historyLimit)));
  input.value = String(value);
  void savePreferences({ historyLimit: value }).catch(report);
};
el('hotkey').onclick = () => {
  void (async () => {
    await api.beginShortcutCapture();
    capturingHotkey = true;
    el('hotkey').textContent = 'Нажмите горячую клавишу…';
    el('hotkey').classList.add('capturing');
    el('cancel-hotkey').hidden = false;
    updateControls(); notice('');
  })().catch(report);
};
function finishHotkeyCapture(): void {
  capturingHotkey = false;
  el('hotkey').classList.remove('capturing');
  el('cancel-hotkey').hidden = true;
  el('hotkey').textContent = prettyHotkey(snapshot.settings.hotkey);
  updateControls();
  void refresh().catch(report);
}
api.onShortcutCaptureEnded(finishHotkeyCapture);
el('cancel-hotkey').onclick = () => { void action(() => api.endShortcutCapture()); };
document.addEventListener('keydown', event => {
  if (!capturingHotkey) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.repeat || savingHotkey) return;
  const key = acceleratorFromEvent(event);
  if (!key) return;
  savingHotkey = true;
  void savePreferences({ hotkey: key }).then(() => notice('Горячая клавиша сохранена.')).catch(report).finally(() => { savingHotkey = false; });
}, true);
window.addEventListener('beforeunload', () => { historyView.stop(); void recorder?.dispose(); void api.cancelRecording(); });
if (!api) notice('Откройте приложение через npm run dev. Обычная вкладка браузера не имеет доступа к Electron.', true);
else void refresh().then(() => soundSettings.refreshDevices(true)).catch(report);
