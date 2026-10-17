import type { Preferences } from './contracts';
import { validateHotkey } from './hotkey';

export const defaultPreferences: Preferences = {
  appLanguage: 'ru',
  hotkey: 'Control+Shift+Space', language: 'auto', pushToTalk: false,
  microphoneId: 'default', inputChannel: 'all', muteWhileRecording: false,
  audioFeedback: false, outputDeviceId: 'default', feedbackVolume: 80,
  hideOnStartup: false, launchAtStartup: true, showTrayIcon: true, overlayMode: 'realtime', indicatorPosition: 'bottom', modelUnloadDelay: '5m', windowSize: 'compact',
  pasteMethod: 'ctrl-v', clipboardHandling: 'restore', autoSubmit: 'off',
  voiceActivityDetection: true, punctuation: true, removeFillerWords: false, customVocabulary: [], appendSpace: false,
  textReplacements: [],
  historyLimit: 5, historyRetention: 'limit',
};

export function validatePreferences(value: unknown, base: Preferences = defaultPreferences): Preferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Некорректные настройки.');
  const input = value as Record<string, unknown>;
  const result = { ...base };
  for (const key of Object.keys(defaultPreferences) as (keyof Preferences)[]) {
    if (key in input) Object.assign(result, { [key]: input[key] });
  }
  validateHotkey(result.hotkey);
  if (!['ru', 'en'].includes(result.appLanguage)) throw new Error('Неподдерживаемый язык приложения.');
  if (!['auto', 'ru', 'en', 'kk', 'uk', 'de', 'fr', 'es', 'bg', 'hr', 'cs', 'da', 'nl', 'et', 'fi', 'el', 'hu', 'it', 'lv', 'lt', 'mt', 'pl', 'pt', 'ro', 'sk', 'sl', 'sv', 'ky', 'uz'].includes(result.language)) throw new Error('Неподдерживаемый код языка.');
  for (const key of ['pushToTalk', 'muteWhileRecording', 'audioFeedback', 'hideOnStartup', 'launchAtStartup', 'showTrayIcon',
    'voiceActivityDetection', 'punctuation', 'removeFillerWords', 'appendSpace'] as const) {
    if (typeof result[key] !== 'boolean') throw new Error('Некорректное значение переключателя.');
  }
  for (const key of ['microphoneId', 'outputDeviceId'] as const) {
    if (typeof result[key] !== 'string' || !result[key].length || result[key].length > 512) throw new Error('Некорректное устройство звука.');
  }
  if (!['all', 'first', 'second'].includes(result.inputChannel)) throw new Error('Некорректный входной канал.');
  if (!Number.isInteger(result.feedbackVolume) || result.feedbackVolume < 0 || result.feedbackVolume > 100) throw new Error('Громкость должна быть от 0 до 100.');
  if (!['bottom', 'top'].includes(result.indicatorPosition)) throw new Error('Некорректная позиция индикатора.');
  if (!['none', 'minimal', 'realtime'].includes(result.overlayMode)) throw new Error('Некорректный режим наложения.');
  if ((result.modelUnloadDelay as string) === '1h') result.modelUnloadDelay = '15m';
  if (!['never', 'immediate', '15s', '2m', '5m', '10m', '15m'].includes(result.modelUnloadDelay)) throw new Error('Некорректное время выгрузки модели.');
  if (!['compact', 'medium'].includes(result.windowSize)) throw new Error('Некорректный размер окна.');
  if (!['ctrl-v', 'direct', 'none', 'ctrl-shift-v', 'shift-insert'].includes(result.pasteMethod)) throw new Error('Некорректный метод вставки.');
  if (!['keep', 'restore'].includes(result.clipboardHandling)) throw new Error('Некорректная обработка буфера обмена.');
  if (!['off', 'enter', 'ctrl-enter'].includes(result.autoSubmit)) throw new Error('Некорректная автоматическая отправка.');
  if (!Array.isArray(result.customVocabulary) || result.customVocabulary.length > 100 || result.customVocabulary.some(word =>
    typeof word !== 'string' || !word.trim() || word.length > 50)) throw new Error('Некорректный пользовательский словарь.');
  result.customVocabulary = [...new Set(result.customVocabulary.map(word => word.trim()))];
  if (!Array.isArray(result.textReplacements) || result.textReplacements.length > 100) throw new Error('Допустимо не более 100 автозамен.');
  const sources = new Set<string>();
  result.textReplacements = result.textReplacements.map(rule => {
    if (!rule || typeof rule !== 'object' || typeof rule.from !== 'string' || typeof rule.to !== 'string'
      || !rule.from.trim() || !rule.to.trim() || rule.from.length > 100 || rule.to.length > 200
      || /[\u0000-\u001f\u007f]/u.test(rule.from + rule.to)) throw new Error('Укажите исходное слово и замену: до 100 и 200 символов.');
    const from = rule.from.trim().normalize('NFC').replace(/[^\S\r\n]+/gu, ' ');
    const to = rule.to.trim().normalize('NFC');
    const key = from.toLowerCase();
    if (sources.has(key)) throw new Error('Для этого слова уже есть автозамена.');
    sources.add(key);
    return { from, to };
  });
  if (!('historyRetention' in input) && typeof input.autoDeleteHistory === 'boolean') result.historyRetention = input.autoDeleteHistory ? 'limit' : 'never';
  if (!Number.isInteger(result.historyLimit) || result.historyLimit < 1 || result.historyLimit > 100) throw new Error('Размер истории должен быть от 1 до 100 записей.');
  if (!['never', 'limit', '3d', '2w', '3m'].includes(result.historyRetention)) throw new Error('Некорректный срок хранения истории.');
  return result;
}
