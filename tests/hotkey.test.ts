import { describe, expect, it } from 'vitest';
import { acceleratorFromEvent, validateHotkey } from '../src/shared/hotkey';
describe('hotkey assignment', () => {
  it.each(['F8', 'Escape', 'Space', 'A', '7', 'Control+Escape', 'Control+Shift+Space', 'Alt+F24'])('accepts %s', key => {
    expect(validateHotkey(key)).toBe(key);
  });
  it.each(['', 'Control', 'Shift', 'F25', 'Control+Control+A', 'Control+', 'A+B', '../escape'])('rejects %s', key => {
    expect(() => validateHotkey(key)).toThrow();
  });
  it('uses physical letter codes independently of Russian layout', () => {
    expect(acceleratorFromEvent({ code: 'KeyA', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false })).toBe('A');
    expect(acceleratorFromEvent({ code: 'Escape', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false })).toBe('Control+Escape');
    expect(acceleratorFromEvent({ code: 'ShiftLeft', ctrlKey: false, shiftKey: true, altKey: false, metaKey: false })).toBeNull();
  });
});
