import { validateHotkey } from '../../shared/hotkey';

export function windowsShortcutKeys(accelerator: string): string {
  validateHotkey(accelerator);
  const named: Record<string, number | string> = {
    Control: 17, CommandOrControl: 17, Alt: 18, Shift: 16, Super: '91/92',
    Space: 32, Escape: 27, Tab: 9, Backspace: 8, Delete: 46, Insert: 45, Enter: 13,
    Home: 36, End: 35, PageUp: 33, PageDown: 34, Up: 38, Down: 40, Left: 37, Right: 39,
    Capslock: 20, Numlock: 144, Scrolllock: 145, PrintScreen: 44,
    Plus: 187, '=': 187, '-': 189, '[': 219, ']': 221, ';': 186, "'": 222,
    ',': 188, '.': 190, '/': 191, '\\': 220, '`': 192,
  };
  return accelerator.split('+').map(key => {
    if (named[key]) return named[key];
    if (/^F\d+$/.test(key)) return 111 + Number(key.slice(1));
    return key.charCodeAt(0);
  }).join(',');
}
