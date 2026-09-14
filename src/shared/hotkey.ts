const modifiers = new Set(['Control', 'CommandOrControl', 'Alt', 'Shift', 'Super']);
const namedKeys = new Set(['Space', 'Escape', 'Tab', 'Backspace', 'Delete', 'Insert', 'Enter', 'Home', 'End', 'PageUp', 'PageDown', 'Up', 'Down', 'Left', 'Right', 'Capslock', 'Numlock', 'Scrolllock', 'PrintScreen', 'Plus', '-', '=', '[', ']', ';', "'", ',', '.', '/', '\\', '`']);

export function validateHotkey(value: unknown): string {
  if (typeof value !== 'string' || value.length > 100) throw new Error('Нажмите клавишу или сочетание клавиш.');
  const parts = value.split('+');
  const key = parts.pop()!;
  if ((!/^[A-Z0-9]$/.test(key) && !/^F([1-9]|1[0-9]|2[0-4])$/.test(key) && !namedKeys.has(key)) ||
      parts.some(part => !modifiers.has(part)) || new Set(parts).size !== parts.length) {
    throw new Error('Эта клавиша не поддерживается. Попробуйте, например, F8 или Ctrl + Space.');
  }
  return value;
}

export function acceleratorFromEvent(event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): string | null {
  const mapped: Record<string, string> = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', CapsLock: 'Capslock', NumLock: 'Numlock', ScrollLock: 'Scrolllock', NumpadEnter: 'Enter', Equal: '=', Minus: '-', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Backquote: '`' };
  const key = mapped[event.code] ?? event.code.replace(/^(Key|Digit)/, '');
  const value = [event.ctrlKey && 'Control', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Super', key].filter(Boolean).join('+');
  try { return validateHotkey(value); } catch { return null; }
}
export function prettyHotkey(value: string): string {
  return value.replace('CommandOrControl', 'Ctrl').replace('Control', 'Ctrl').replace('Super', 'Win').split('+').join(' + ');
}
