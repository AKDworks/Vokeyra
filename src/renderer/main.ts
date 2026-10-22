import './desktop-bridge';
import type { AppUpdateState, DownloadState, LinuxDesktopInfo, Preferences, Snapshot } from '../shared/contracts';
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
import { onAppLanguageChange, setAppLanguage, tr } from './i18n';
import { MicrophoneAccess } from './microphone-access';
import { MicrophoneAccessError } from './microphone-errors';
import { version as appVersion } from '../../package.json';

(document.getElementById('brand-logo') as HTMLImageElement).src = brandLogo;
setupIcons();
setupInfoTooltips();
// Version and microphone recovery must remain available if the ASR service
// fails to initialize. Neither depends on a successful service snapshot.
document.getElementById('footer-version')!.textContent = `Vokeyra ${appVersion}`;
document.getElementById('app-version')!.textContent = `v${appVersion}`;

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
let pendingHotkey: { accelerator: string; code: string } | undefined;
let heldSession = false;
let updateInProgress = false;
let maintenanceInProgress = false;
let microphonePermissionBusy = false;
let confirmationOpen = false;
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
const microphoneAccess = new MicrophoneAccess(api, () => soundSettings.refreshDevices(false), requesting => {
  microphonePermissionBusy = requesting; updateControls();
});
const microphoneReady = microphoneAccess.initialize(navigator.userAgent.includes('Windows'));

const modelsView = new ModelsView(api, () => refresh(true));
const historyView = new HistoryView(el('history-list'), api, refresh, async id => {
  if (mode !== 'idle' || capturingHotkey) return;
  historyView.stop(); mode = 'transcribing'; updateControls();
  try { await api.retranscribeHistory(id); }
  finally { mode = 'idle'; updateControls(); await refresh(); }
});

function notice(message: string, error = false): void {
  el('notice-text').textContent = message;
  el('notice').hidden = !message;
  el('notice').classList.toggle('error', error);
}
el('dismiss-notice').onclick = () => notice('');
function report(error: unknown): void {
  if (error instanceof MicrophoneAccessError) { microphoneAccess.blocked(); showTab('general'); }
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
  const recordingBusy = mode !== 'idle';
  const busy = recordingBusy || updateInProgress || maintenanceInProgress || microphonePermissionBusy;
  historyView.setBusy(busy || capturingHotkey);
  appLanguageSelect.setDisabled(busy || capturingHotkey);
  languageSelect.setDisabled(busy || capturingHotkey);
  soundSettings.setBusy(busy || capturingHotkey);
  microphoneAccess.setBusy(busy || capturingHotkey);
  settingSelectList.forEach(select => select.setDisabled(busy || capturingHotkey));
  el('cancel-recording').hidden = !recordingBusy;
  el<HTMLButtonElement>('record').disabled = updateInProgress || maintenanceInProgress || microphonePermissionBusy || capturingHotkey || mode === 'starting' || mode === 'transcribing';
  el('record').classList.toggle('recording', mode === 'recording');
  el('record').setAttribute('aria-label', mode === 'recording' ? 'Остановить запись' : 'Начать запись');
  el('record').textContent = mode === 'recording' ? 'Завершить' : mode === 'transcribing' ? 'Обработка…' : 'Начать запись';
  el('record-status').textContent = { idle: 'Готово к записи', starting: 'Подключаем микрофон…', recording: 'Идёт запись', transcribing: 'Распознаём на устройстве…' }[mode];
  document.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('#advanced input, #advanced button, #language').forEach(item => {
    item.disabled = busy || capturingHotkey || item.dataset.unavailable === 'true';
  });
  // Keep the capture button focused and enabled so WebView2 receives native keys.
  el<HTMLButtonElement>('hotkey').disabled = busy;
  if (snapshot) {
    el<HTMLButtonElement>('hotkey').disabled ||= !snapshot.desktop.globalShortcut;
    el<HTMLButtonElement>('push-to-talk').disabled ||= !snapshot.desktop.pushToTalk;
    el<HTMLButtonElement>('mute-recording').disabled ||= !snapshot.desktop.muteAudio;
    settingSelects.pasteMethod.setDisabled(busy || capturingHotkey || !snapshot.desktop.automaticPaste);
    settingSelects.clipboardHandling.setDisabled(busy || capturingHotkey || !snapshot.desktop.automaticPaste);
    settingSelects.autoSubmit.setDisabled(busy || capturingHotkey || !snapshot.desktop.automaticPaste);
  }
  const refreshIntegrations = document.getElementById('refresh-integrations') as HTMLButtonElement | null;
  if (refreshIntegrations) refreshIntegrations.disabled = busy || capturingHotkey;
  const openHotkeyConfig = document.getElementById('open-hotkey-config') as HTMLButtonElement | null;
  if (openHotkeyConfig) openHotkeyConfig.disabled = busy || capturingHotkey;
  updateButton.disabled = updateInProgress || maintenanceInProgress;
  if (snapshot) renderModels();
}
async function refresh(fillSettings = false): Promise<void> {
  snapshot = await api.snapshot();
  setAppLanguage(snapshot.settings.appLanguage);
  const manualRecording = el<HTMLDetailsElement>('manual-recording');
  manualRecording.hidden = snapshot.desktop.platform !== 'linux';
  if (!initialized && snapshot.desktop.platform === 'linux') manualRecording.open = true;
  el('platform-note').textContent = tr(snapshot.desktop.warning ?? '');
  el('platform-note').hidden = !snapshot.desktop.warning;
  if (snapshot.desktop.linux) renderLinux(snapshot.desktop.linux);
  else el('linux-integrations').hidden = true;
  el('push-to-talk').dataset.unavailable = String(!snapshot.desktop.pushToTalk);
  el('mute-recording').dataset.unavailable = String(!snapshot.desktop.muteAudio);
  for (const [id, available] of [['hotkey', snapshot.desktop.globalShortcut], ['push-to-talk', snapshot.desktop.pushToTalk], ['mute-recording', snapshot.desktop.muteAudio]] as const) {
    el(id).closest('.setting-row')?.classList.toggle('unavailable', !available);
  }
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
    if (!snapshot.desktop.automaticPaste) settingSelects.pasteMethod.setValue('none');
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
    renderReplacements();
  }
  if (!capturingHotkey) el('hotkey').textContent = prettyHotkey(snapshot.settings.hotkey);
  el('data-path').textContent = snapshot.dataPath;
  el('app-version').textContent = `v${snapshot.appVersion}`;
  el('footer-version').textContent = `Vokeyra ${snapshot.appVersion}`;
  const selected = snapshot.models.find(item => item.model.id === snapshot.settings.selectedModelId && item.installed);
  el('selected-model').textContent = selected ? `${selected.installed!.model.name} · ${snapshot.settings.language === 'auto' ? 'Авто' : snapshot.settings.language.toUpperCase()}` : 'Модель не выбрана';
  if (!initialized) {
    // The Linux diagnostics section and platform note already show this
    // explanation; reserve the notice bar for errors and status messages.
    if (snapshot.desktop.warning && !snapshot.desktop.linux) notice(snapshot.desktop.warning);
    else if (!snapshot.hotkeyRegistered && snapshot.desktop.session !== 'wayland') notice('Горячая клавиша занята. Выберите другую на вкладке «Главное».', true);
    else if (!selected) notice('Скачайте модель во вкладке «Модели» — она выберется автоматически.');
    else if (!snapshot.engineReady) notice('Встроенный движок модели недоступен. Переустановите Vokeyra.', true);
  }
  initialized = true;
  renderDangerAvailability();
  updateControls();
  renderHistory();
}
function renderLinux(info: LinuxDesktopInfo): void {
  const container = el('linux-integrations');
  container.hidden = false;
  const session = info.session === 'wayland' ? 'Wayland' : info.session === 'x11' ? 'X11' : tr('Неизвестный сеанс');
  const portal = info.portal === 'available' ? 'GlobalShortcuts portal доступен'
    : info.portal === 'unavailable' ? 'GlobalShortcuts portal недоступен' : 'Portal не проверен';
  el('linux-summary').textContent = `${info.compositorName} · ${session} · ${tr(portal)}`;
  const names: Record<string, string> = {
    hotkey: 'Горячая клавиша', pushToTalk: 'Удержание для записи',
    paste: 'Вставка текста', overlay: 'Индикатор записи',
  };
  const states: Record<string, string> = {
    active: 'Работает', ready: 'Готово', setup: 'Требуется настройка',
    unavailable: 'Недоступно', error: 'Ошибка',
  };
  const list = el('linux-integration-list');
  list.replaceChildren();
  for (const item of info.integrations) {
    const row = document.createElement('div'); row.className = 'integration-row';
    const copy = document.createElement('div'); copy.className = 'integration-copy';
    const name = document.createElement('div'); name.className = 'integration-name'; name.textContent = tr(names[item.id] ?? item.id);
    const detail = document.createElement('div'); detail.className = 'integration-detail'; detail.textContent = tr(item.detail);
    copy.append(name, detail);
    if (item.action) {
      const action = document.createElement('div'); action.className = 'integration-action'; action.textContent = tr(item.action);
      copy.append(action);
    }
    const badge = document.createElement('span'); badge.className = `integration-badge ${item.state}`;
    badge.textContent = tr(states[item.state] ?? item.state);
    row.append(copy, badge); list.append(row);
  }
  const hintBox = el<HTMLDetailsElement>('linux-hint-box');
  const hint = info.hotkeyHint;
  hintBox.hidden = !hint;
  if (hint) {
    el('linux-hint').textContent = hint;
    el('linux-hint-note').textContent = tr(info.compositor === 'niri'
      ? 'niri передаёт только нажатие, поэтому используйте vokeyra --toggle. Для удержания нужен swhkd.'
      : info.compositor === 'hyprland' || info.compositor === 'sway'
        ? 'Для удержания добавьте отдельные привязки vokeyra --press и vokeyra --release.'
        : 'Добавьте vokeyra --toggle как пользовательскую горячую клавишу в настройках системы.');
  }
  const overlayBox = el<HTMLDetailsElement>('linux-overlay-hint-box');
  let overlayRule = '';
  if (info.session === 'wayland' && info.overlay.mode !== 'layer-shell') {
    if (info.compositor === 'niri') {
      overlayRule = 'window-rule {\n    match title="^Vokeyra Indicator$"\n    open-floating true\n    default-column-width { fixed 248; }\n    default-window-height { fixed 58; }\n    open-focused false\n}';
    } else if (info.compositor === 'sway') {
      overlayRule = 'for_window [title="^Vokeyra Indicator$"] floating enable, resize set 248 58';
    } else if (info.compositor === 'hyprland') {
      overlayRule = 'windowrulev2 = float,title:^(Vokeyra Indicator)$\nwindowrulev2 = size 248 58,title:^(Vokeyra Indicator)$';
    }
  }
  overlayBox.hidden = !overlayRule;
  if (overlayRule) el('linux-overlay-hint').textContent = overlayRule;
  el('open-hotkey-config').hidden = info.session !== 'wayland';
}

function renderHistory(): void { historyView.render(snapshot.history, snapshot.desktop.platform === 'linux'); }
function renderModels(): void { if (snapshot) modelsView.update(snapshot, downloads, mode !== 'idle' || capturingHotkey || updateInProgress || maintenanceInProgress); }
async function toggleRecording(fromHold = false): Promise<void> {
  if (updateInProgress || maintenanceInProgress || microphonePermissionBusy || confirmationOpen || capturingHotkey || mode === 'starting' || mode === 'transcribing') return;
  if (!snapshot) {
    try { await refresh(); } catch { return; }
  }
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
el('open-licenses').onclick = () => { void action(() => api.openLicenses()); };
el('open-github').onclick = () => { void action(() => api.openGithub()); };
el('open-recordings').onclick = () => { void action(() => api.openRecordingsFolder()); };
el('refresh-integrations').onclick = () => {
  const button = el<HTMLButtonElement>('refresh-integrations');
  button.disabled = true;
  void api.recheckIntegrations().then(() => refresh(true)).catch(report).finally(() => updateControls());
};
el('open-hotkey-config').onclick = () => { void action(() => api.openHotkeyConfig()); };
const updateButton = el<HTMLButtonElement>('check-updates');
let updateState: AppUpdateState = { phase: 'idle', currentVersion: '' };
function renderUpdate(state: AppUpdateState): void {
  updateState = state;
  updateInProgress = ['checking', 'available', 'downloading', 'installing'].includes(state.phase);
  updateButton.disabled = updateInProgress;
  updateButton.classList.toggle('update-available', ['available', 'downloading', 'installing'].includes(state.phase));
  const labels: Record<AppUpdateState['phase'], string> = {
    idle: 'Проверить наличие обновлений',
    checking: 'Проверяем обновления…',
    available: state.latestVersion ? `Найдена версия ${state.latestVersion}…` : 'Обновление найдено…',
    downloading: `Скачивание обновления ${state.percent ?? 0}%`,
    current: 'Обновление не требуется',
    installing: state.latestVersion ? `Устанавливаем версию ${state.latestVersion}…` : 'Устанавливаем обновление…',
    error: 'Не удалось обновить · Повторить',
  };
  updateButton.textContent = tr(labels[state.phase]);
  updateControls();
  if (state.phase === 'error' && state.message) notice(state.message, true);
}
updateButton.onclick = () => {
  renderUpdate({ phase: 'checking', currentVersion: snapshot.appVersion });
  void api.startUpdate().then(renderUpdate).catch(error => {
    if (updateState.phase === 'checking') {
      renderUpdate({ phase: 'error', currentVersion: snapshot.appVersion, message: error instanceof Error ? error.message : String(error) });
    }
  });
};
api.onUpdateState(renderUpdate);
onAppLanguageChange(() => renderUpdate(updateState));

const confirmBackdrop = el('confirm-backdrop');
const confirmPanel = el('confirm-dialog');
const confirmCancel = el<HTMLButtonElement>('confirm-cancel');
const confirmAccept = el<HTMLButtonElement>('confirm-accept');
const appShell = document.querySelector<HTMLElement>('.app')!;
let finishConfirmation: ((confirmed: boolean) => void) | undefined;
let confirmationFocus: HTMLElement | null = null;

function closeConfirmation(confirmed: boolean): void {
  if (confirmBackdrop.hidden) return;
  confirmBackdrop.hidden = true;
  confirmationOpen = false;
  appShell.inert = false;
  const finish = finishConfirmation; finishConfirmation = undefined;
  const focus = confirmationFocus; confirmationFocus = null;
  finish?.(confirmed);
  focus?.focus({ preventScroll: true });
}
function confirmAction(title: string, message: string, acceptLabel: string): Promise<boolean> {
  if (finishConfirmation) closeConfirmation(false);
  confirmationFocus = document.activeElement as HTMLElement | null;
  el('confirm-title').textContent = tr(title);
  el('confirm-message').textContent = tr(message);
  confirmAccept.textContent = tr(acceptLabel);
  confirmBackdrop.hidden = false;
  confirmationOpen = true;
  appShell.inert = true;
  confirmCancel.focus();
  return new Promise(resolve => { finishConfirmation = resolve; });
}
confirmCancel.onclick = () => closeConfirmation(false);
confirmAccept.onclick = () => closeConfirmation(true);
confirmBackdrop.onpointerdown = event => { if (event.target === confirmBackdrop) closeConfirmation(false); };
confirmPanel.onkeydown = event => {
  if (event.key === 'Escape') { event.preventDefault(); closeConfirmation(false); return; }
  if (event.key !== 'Tab') return;
  const controls = [confirmCancel, confirmAccept].filter(button => !button.disabled);
  const current = controls.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.shiftKey ? (current <= 0 ? controls.length - 1 : current - 1) : (current + 1) % controls.length;
  event.preventDefault(); controls[next]?.focus();
};

function renderDangerAvailability(): void {
  const historyUnavailable = !snapshot.history.length;
  const modelDownloadActive = snapshot.downloads.some(item => ['downloading', 'verifying'].includes(item.phase));
  const modelsUnavailable = !snapshot.models.some(item => item.installed) || modelDownloadActive;
  for (const [id, unavailable] of [['clear-history', historyUnavailable], ['delete-all-models', modelsUnavailable]] as const) {
    const button = el<HTMLButtonElement>(id);
    button.dataset.unavailable = String(unavailable);
    button.disabled = unavailable || mode !== 'idle' || capturingHotkey || updateInProgress || maintenanceInProgress;
  }
}
function showDangerStatus(message: string, error = false): void {
  const status = el('danger-status');
  status.textContent = tr(message);
  status.classList.toggle('error', error);
  status.hidden = !message;
}
async function runDanger(options: { title: string; message: string; accept: string; success: string },
  operation: () => Promise<unknown>, successOverride?: () => { message: string; error?: boolean }): Promise<void> {
  showDangerStatus('');
  if (!await confirmAction(options.title, options.message, options.accept)) return;
  maintenanceInProgress = true; updateControls();
  try {
    historyView.stop();
    modelsView.close();
    await operation();
    await refresh(true);
    const result = successOverride?.() ?? { message: options.success };
    showDangerStatus(result.message, !!result.error);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showDangerStatus(message.replace(/^Error invoking remote method '[^']+': Error: /, ''), true);
  } finally {
    maintenanceInProgress = false;
    renderDangerAvailability();
    updateControls();
  }
}
el('reset-settings').onclick = () => {
  void runDanger({
    title: 'Сбросить все настройки?',
    message: 'Все параметры приложения, включая горячую клавишу и выбранную модель, вернутся к исходным значениям. История и скачанные модели сохранятся.',
    accept: 'Сбросить', success: 'Настройки сброшены.',
  }, () => api.resetSettings(), () => snapshot.hotkeyRegistered
    ? { message: 'Настройки сброшены.' }
    : { message: 'Настройки сброшены, но горячая клавиша по умолчанию занята другим приложением.', error: true });
};
el('clear-history').onclick = () => {
  void runDanger({
    title: 'Очистить всю историю?',
    message: 'Все записи истории и сохранённые аудиофайлы будут удалены без возможности восстановления.',
    accept: 'Очистить', success: 'История очищена.',
  }, () => api.clearHistory());
};
el('delete-all-models').onclick = () => {
  void runDanger({
    title: 'Удалить все скачанные модели?',
    message: 'Все скачанные модели будут удалены с устройства. Для распознавания речи модель потребуется скачать заново.',
    accept: 'Удалить', success: 'Скачанные модели удалены.',
  }, () => api.deleteAllModels());
};

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
function replacementError(error?: unknown): void {
  const message = el('replacement-error');
  message.textContent = error ? tr(error instanceof Error ? error.message : String(error)) : '';
  message.hidden = !error;
}
function renderReplacements(): void {
  const list = el('replacement-list');
  list.replaceChildren();
  for (const [index, rule] of snapshot.settings.textReplacements.entries()) {
    const row = document.createElement('div'); row.className = 'replacement-item';
    const text = document.createElement('span'); text.className = 'replacement-text'; text.textContent = `${rule.from} → ${rule.to}`;
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'icon-button';
    remove.setAttribute('aria-label', tr('Удалить автозамену')); setIcon(remove, 'close');
    remove.onclick = () => {
      remove.disabled = true; replacementError();
      void savePreferences({ textReplacements: snapshot.settings.textReplacements.filter((_, item) => item !== index) })
        .catch(error => { replacementError(error); remove.disabled = false; });
    };
    row.append(text, remove); list.append(row);
  }
  list.hidden = !list.childElementCount;
}
el<HTMLFormElement>('replacement-form').onsubmit = event => {
  event.preventDefault(); replacementError();
  const from = el<HTMLInputElement>('replacement-from'), to = el<HTMLInputElement>('replacement-to');
  if (!from.value.trim() || !to.value.trim()) { replacementError('Укажите исходное слово и замену: до 100 и 200 символов.'); return; }
  const submit = el<HTMLFormElement>('replacement-form').querySelector<HTMLButtonElement>('button')!;
  submit.disabled = true;
  void savePreferences({ textReplacements: [...snapshot.settings.textReplacements, { from: from.value, to: to.value }] })
    .then(() => { from.value = ''; to.value = ''; from.focus(); })
    .catch(replacementError).finally(() => updateControls());
};
for (const id of ['replacement-from', 'replacement-to']) el(id).addEventListener('input', () => replacementError());
el<HTMLInputElement>('history-limit').onchange = () => {
  const input = el<HTMLInputElement>('history-limit');
  const value = Math.max(1, Math.min(100, Math.round(Number(input.value) || snapshot.settings.historyLimit)));
  input.value = String(value);
  void savePreferences({ historyLimit: value }).catch(report);
};
el('hotkey').onclick = () => {
  if (capturingHotkey || savingHotkey) return;
  void (async () => {
    await api.beginShortcutCapture();
    capturingHotkey = true;
    el('hotkey').textContent = 'Нажмите горячую клавишу…';
    el('hotkey').classList.add('capturing');
    el('cancel-hotkey').hidden = false;
    updateControls(); notice('');
    el('hotkey').focus({ preventScroll: true });
  })().catch(report);
};
function finishHotkeyCapture(): void {
  capturingHotkey = false;
  pendingHotkey = undefined;
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
  if (event.repeat || savingHotkey || pendingHotkey) return;
  const key = acceleratorFromEvent(event);
  if (!key) return;
  pendingHotkey = { accelerator: key, code: event.code };
  el('hotkey').textContent = prettyHotkey(key);
}, true);
document.addEventListener('keyup', event => {
  if (!capturingHotkey) return;
  event.preventDefault();
  event.stopPropagation();
  if (!pendingHotkey || pendingHotkey.code !== event.code || savingHotkey) return;
  const key = pendingHotkey.accelerator;
  pendingHotkey = undefined;
  // Register only after release; assigning a held key must not start recording.
  savingHotkey = true;
  void savePreferences({ hotkey: key }).then(() => notice('Горячая клавиша сохранена.')).catch(report).finally(() => { savingHotkey = false; });
}, true);
window.addEventListener('beforeunload', () => { historyView.stop(); void recorder?.dispose(); void api.cancelRecording(); });
if (!api) {
  el('boot-screen').hidden = true;
  document.body.classList.remove('booting');
  document.body.removeAttribute('aria-busy');
  notice('Откройте приложение через npm run dev. Обычная вкладка браузера не имеет доступа к Vokeyra.', true);
} else void refresh().then(() => {
  el('boot-screen').hidden = true;
  document.body.classList.remove('booting');
  document.body.removeAttribute('aria-busy');
  return Promise.all([microphoneReady, soundSettings.refreshDevices(false)]);
}).catch(error => {
  el('boot-screen').hidden = true;
  document.body.classList.remove('booting');
  document.body.removeAttribute('aria-busy');
  report(error);
});
window.addEventListener('vokeyra-service-error', event => {
  report((event as CustomEvent<string>).detail);
  el('notice').hidden = false;
});
