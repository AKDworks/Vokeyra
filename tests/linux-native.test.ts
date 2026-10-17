import { afterEach, describe, expect, it, vi } from 'vitest';
import { LinuxNative, type LinuxCommand } from '../src/main/platform/linux-native';
import { defaultPreferences, validatePreferences } from '../src/shared/preferences';

afterEach(() => vi.unstubAllEnvs());
describe('Linux integration', () => {
  it('passes dictated text through stdin rather than treating it as arguments or commands', async () => {
    vi.stubEnv('XDG_SESSION_TYPE', 'x11'); vi.stubEnv('WAYLAND_DISPLAY', ''); vi.stubEnv('DISPLAY', ':1');
    const run = vi.fn<LinuxCommand>().mockResolvedValue('');
    const native = new LinuxNative(run, async name => `/usr/bin/${name}`);
    await native.start();
    const text = '--help; $(touch /tmp/no)\nПривет';
    await native.command('type', Buffer.from(text).toString('base64'));
    expect(run).toHaveBeenCalledWith('/usr/bin/xdotool', ['type', '--clearmodifiers', '--delay', '0', '--file', '-'], { input: text, timeout: 30_000 });
    await expect(native.command('key', 'exec rm')).rejects.toThrow('Неподдерживаемое сочетание');
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('uses native Wayland clipboard tools and reports unavailable global input honestly', async () => {
    vi.stubEnv('XDG_SESSION_TYPE', 'wayland'); vi.stubEnv('WAYLAND_DISPLAY', 'wayland-0');
    const run = vi.fn<LinuxCommand>().mockResolvedValue('previous');
    const fallback = vi.fn();
    const native = new LinuxNative(run, async name => `/usr/bin/${name}`);
    await native.start();
    expect(native.capabilities()).toMatchObject({ globalShortcut: false, pushToTalk: false, automaticPaste: false, muteAudio: false });
    await native.clipboardWrite('Привет', fallback);
    expect(run).toHaveBeenCalledWith('/usr/bin/wl-copy', ['--type', 'text/plain;charset=utf-8'], { input: 'Привет', quiet: true });
    expect(await native.clipboardRead(fallback)).toBe('previous');
    expect(fallback).not.toHaveBeenCalled();
    await expect(native.command('key', 'ctrl-v')).rejects.toThrow('недоступна');
  });
  it('keeps copy-only operation available when xdotool is missing', async () => {
    vi.stubEnv('XDG_SESSION_TYPE', 'x11'); vi.stubEnv('WAYLAND_DISPLAY', ''); vi.stubEnv('DISPLAY', ':1');
    const native = new LinuxNative(vi.fn(), async () => undefined);
    await native.start();
    expect(native.capabilities().automaticPaste).toBe(false);
    const copy = vi.fn().mockResolvedValue(undefined);
    await native.clipboardWrite('text', copy);
    expect(copy).toHaveBeenCalledWith('text');
    expect(validatePreferences({ pasteMethod: 'none' }, defaultPreferences).pasteMethod).toBe('none');
  });
});
