import { describe, expect, it } from 'vitest';
import { defaultPreferences, validatePreferences } from '../src/shared/preferences';
import { windowsShortcutKeys } from '../src/main/platform/windows-keys';

describe('recording settings', () => {
  it('migrates existing settings without changing the old shortcut or language', () => {
    expect(validatePreferences({ hotkey: 'End', language: 'ru', catalogUrl: 'https://old.example/models.json' })).toEqual({ ...defaultPreferences, hotkey: 'End', language: 'ru' });
  });
  it('preserves unrelated sound settings when a single field is saved', () => {
    const base = { ...defaultPreferences, microphoneId: 'usb-mic', inputChannel: 'second' as const, feedbackVolume: 40 };
    expect(validatePreferences({ language: 'kk' }, base)).toEqual({ ...base, language: 'kk' });
  });
  it.each([{ appLanguage: 'de' }, { pushToTalk: 'true' }, { muteWhileRecording: 1 }, { feedbackVolume: -1 }, { feedbackVolume: 101 }, { feedbackVolume: NaN }, { inputChannel: 'third' }, { microphoneId: '' }, { outputDeviceId: null }, { historyLimit: 0 }, { historyLimit: 101 }])('rejects invalid values %j', value => {
    expect(() => validatePreferences(value)).toThrow();
  });
  it('maps single keys and modifier combinations for release monitoring', () => {
    expect(windowsShortcutKeys('End')).toBe('35');
    expect(windowsShortcutKeys('Control+Shift+Space')).toBe('17,16,32');
    expect(windowsShortcutKeys('Super+F24')).toBe('91/92,135');
    expect(() => windowsShortcutKeys('Control+Injected')).toThrow();
  });
});
