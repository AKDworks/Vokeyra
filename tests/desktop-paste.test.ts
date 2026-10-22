import { beforeEach, expect, it, vi } from 'vitest';
import { defaultPreferences } from '../src/shared/preferences';

const mocks = vi.hoisted(() => ({ host: vi.fn(), command: vi.fn(), clipboard: '' }));
vi.mock('../src/main/host', () => ({ config: {}, host: mocks.host }));
vi.mock('../src/main/platform/windows-native', () => ({ WindowsNative: class {
  command = mocks.command;
} }));
vi.mock('../src/main/platform/linux-native', () => ({ LinuxNative: class {
  command = mocks.command;
  capabilities = () => ({ automaticPaste: true });
  clipboardRead = async () => mocks.clipboard;
  clipboardWrite = async (value: string) => { mocks.clipboard = value; };
  restoreClipboard = async (dictated: string, previous: string) => {
    if (mocks.clipboard !== dictated) return false;
    mocks.clipboard = previous; return true;
  };
} }));
import { desktop } from '../src/main/platform/desktop';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.command.mockReset();
  mocks.host.mockImplementation(async (method: string, value?: string) => {
    if (method === 'clipboard:read') return mocks.clipboard;
    if (method === 'clipboard:write') mocks.clipboard = value!;
  });
});

it.each(['previous text', ''])('restores the clipboard when automatic insertion fails: %j', async previous => {
  mocks.clipboard = previous;
  mocks.command.mockRejectedValue(new Error('Input helper unavailable'));
  await expect(desktop.deliverText('dictation', { ...defaultPreferences, pasteMethod: 'ctrl-v', clipboardHandling: 'restore' }))
    .rejects.toThrow('Input helper unavailable');
  expect(mocks.clipboard).toBe(previous);
});

it('keeps the dictated text in the clipboard when the user selected keep', async () => {
  mocks.clipboard = 'previous text';
  mocks.command.mockRejectedValue(new Error('Input helper unavailable'));
  await expect(desktop.deliverText('dictation', { ...defaultPreferences, pasteMethod: 'ctrl-v', clipboardHandling: 'keep' })).rejects.toThrow();
  expect(mocks.clipboard).toBe('dictation');
});

it('does not overwrite clipboard contents the user changed while pasting', async () => {
  mocks.clipboard = 'previous text';
  let reads = 0;
  mocks.host.mockImplementation(async (method: string, value?: string) => {
    if (method === 'clipboard:read') { reads += 1; return reads === 1 ? 'previous text' : 'user replacement'; }
    if (method === 'clipboard:write') mocks.clipboard = value!;
  });
  mocks.command.mockImplementation(async () => { mocks.clipboard = 'user replacement'; return ''; });
  await desktop.deliverText('dictation', { ...defaultPreferences, pasteMethod: 'ctrl-v', clipboardHandling: 'restore' });
  expect(mocks.clipboard).toBe('user replacement');
});

it('inserts once and leaves the text in history when the input helper fails', async () => {
  mocks.clipboard = 'previous';
  mocks.command.mockRejectedValue(new Error('Input helper unavailable'));
  await expect(desktop.deliverText('dictation', { ...defaultPreferences, pasteMethod: 'ctrl-v', clipboardHandling: 'keep' }))
    .rejects.toThrow('Input helper unavailable');
  expect(mocks.command).toHaveBeenCalledTimes(1);
});
