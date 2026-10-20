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
