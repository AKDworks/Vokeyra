import { afterEach, describe, expect, it, vi } from 'vitest';
import { LinuxNative, formatSwhkdConfig, type LinuxCommand } from '../src/main/platform/linux-native';
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

  it('uses native Wayland clipboard tools and reports unavailable global input honestly when no injection tools exist', async () => {
    vi.stubEnv('XDG_SESSION_TYPE', 'wayland'); vi.stubEnv('WAYLAND_DISPLAY', 'wayland-0');
    const run = vi.fn<LinuxCommand>().mockResolvedValue('previous');
    const fallback = vi.fn();
    const native = new LinuxNative(run, async name => ['wl-copy', 'wl-paste'].includes(name) ? `/usr/bin/${name}` : undefined);
    await native.start();
    expect(native.capabilities()).toMatchObject({ globalShortcut: false, pushToTalk: false, automaticPaste: false, directTyping: false, muteAudio: false });
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

  it('uses wtype on Wayland for direct typing and key chords', async () => {
    vi.stubEnv('XDG_SESSION_TYPE', 'wayland'); vi.stubEnv('WAYLAND_DISPLAY', 'wayland-0');
    const run = vi.fn<LinuxCommand>().mockResolvedValue('');
    const native = new LinuxNative(run, async name => ['wl-copy', 'wl-paste', 'wtype'].includes(name) ? `/usr/bin/${name}` : undefined);
    await native.start();
    expect(native.capabilities()).toMatchObject({ automaticPaste: true, directTyping: true, globalShortcut: false });

    const text = 'Тестовый текст Wayland';
    await native.command('type', Buffer.from(text).toString('base64'));
    expect(run).toHaveBeenCalledWith('/usr/bin/wtype', ['-'], { input: text, timeout: 30_000 });

    await native.command('key', 'ctrl-v');
    expect(run).toHaveBeenCalledWith('/usr/bin/wtype', ['-M', 'ctrl', '-k', 'v', '-m', 'ctrl']);

    await native.command('key', 'ctrl-shift-v');
    expect(run).toHaveBeenCalledWith('/usr/bin/wtype', ['-M', 'ctrl', '-M', 'shift', '-k', 'v', '-m', 'shift', '-m', 'ctrl']);

    await native.command('key', 'shift-insert');
    expect(run).toHaveBeenCalledWith('/usr/bin/wtype', ['-M', 'shift', '-k', 'Insert', '-m', 'shift']);

    await native.command('key', 'enter');
    expect(run).toHaveBeenCalledWith('/usr/bin/wtype', ['-k', 'Return']);

    await native.command('key', 'ctrl-enter');
    expect(run).toHaveBeenCalledWith('/usr/bin/wtype', ['-M', 'ctrl', '-k', 'Return', '-m', 'ctrl']);
  });

  it('falls back to ydotool on Wayland when wtype is absent', async () => {
    vi.stubEnv('XDG_SESSION_TYPE', 'wayland'); vi.stubEnv('WAYLAND_DISPLAY', 'wayland-0');
    const run = vi.fn<LinuxCommand>().mockResolvedValue('');
    const native = new LinuxNative(run, async name => ['wl-copy', 'wl-paste', 'ydotool'].includes(name) ? `/usr/bin/${name}` : undefined);
    await native.start();
    expect(native.capabilities()).toMatchObject({ automaticPaste: true, directTyping: true });

    await native.command('key', 'ctrl-v');
    expect(run).toHaveBeenCalledWith('/usr/bin/ydotool', ['key', '29:1', '47:1', '47:0', '29:0']);

    await native.command('type', Buffer.from('abc').toString('base64'));
    expect(run).toHaveBeenCalledWith('/usr/bin/wl-copy', ['--type', 'text/plain;charset=utf-8'], { input: 'abc', quiet: true });
  });

  it('falls back to dotool on Wayland when wtype and ydotool are absent', async () => {
    vi.stubEnv('XDG_SESSION_TYPE', 'wayland'); vi.stubEnv('WAYLAND_DISPLAY', 'wayland-0');
    const run = vi.fn<LinuxCommand>().mockResolvedValue('');
    const native = new LinuxNative(run, async name => ['wl-copy', 'wl-paste', 'dotool'].includes(name) ? `/usr/bin/${name}` : undefined);
    await native.start();
    expect(native.capabilities()).toMatchObject({ automaticPaste: true, directTyping: true });

    await native.command('key', 'ctrl-v');
    expect(run).toHaveBeenCalledWith('/usr/bin/dotool', [], { input: 'key ctrl+v\n' });
  });

  it('generates valid swhkd config with press and @release bindings', () => {
    const config = formatSwhkdConfig('Control+Shift+Space', '/usr/bin/vokeyra');
    expect(config).toContain('control + shift + space\n\t/usr/bin/vokeyra --press');
    expect(config).toContain('@control + shift + space\n\t/usr/bin/vokeyra --release');

    const singleKey = formatSwhkdConfig('F8', '/opt/Vokeyra/vokeyra');
    expect(singleKey).toContain('f8\n\t/opt/Vokeyra/vokeyra --press');
    expect(singleKey).toContain('@f8\n\t/opt/Vokeyra/vokeyra --release');
  });

  it('manages system audio mute and restore via pactl', async () => {
    vi.stubEnv('XDG_SESSION_TYPE', 'wayland'); vi.stubEnv('WAYLAND_DISPLAY', 'wayland-0');
    const run = vi.fn<LinuxCommand>().mockImplementation(async (_cmd, args) => {
      if (args[0] === 'get-sink-mute') return 'Mute: no\n';
      return '';
    });
    const native = new LinuxNative(run, async name => name === 'pactl' ? `/usr/bin/${name}` : undefined);
    await native.start();
    expect(native.capabilities().muteAudio).toBe(true);

    await native.command('mute');
    expect(run).toHaveBeenCalledWith('/usr/bin/pactl', ['get-sink-mute', '@DEFAULT_SINK@']);
    expect(run).toHaveBeenCalledWith('/usr/bin/pactl', ['set-sink-mute', '@DEFAULT_SINK@', '1']);

    await native.command('restore');
    expect(run).toHaveBeenCalledWith('/usr/bin/pactl', ['set-sink-mute', '@DEFAULT_SINK@', '0']);
  });

  it('does not unmute if the audio was already muted prior to recording', async () => {
    vi.stubEnv('XDG_SESSION_TYPE', 'wayland'); vi.stubEnv('WAYLAND_DISPLAY', 'wayland-0');
    const run = vi.fn<LinuxCommand>().mockImplementation(async (_cmd, args) => {
      if (args[0] === 'get-sink-mute') return 'Mute: yes\n';
      return '';
    });
    const native = new LinuxNative(run, async name => name === 'pactl' ? `/usr/bin/${name}` : undefined);
    await native.start();

    await native.command('mute');
    expect(run).toHaveBeenCalledTimes(1);

    await native.command('restore');
    // Restore should not unmute since it was already muted
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('manages system audio mute and restore via wpctl', async () => {
    vi.stubEnv('XDG_SESSION_TYPE', 'wayland'); vi.stubEnv('WAYLAND_DISPLAY', 'wayland-0');
    const run = vi.fn<LinuxCommand>().mockImplementation(async (_cmd, args) => {
      if (args[0] === 'get-volume') return 'Volume: 0.75\n';
      return '';
    });
    const native = new LinuxNative(run, async name => name === 'wpctl' ? `/usr/bin/${name}` : undefined);
    await native.start();
    expect(native.capabilities().muteAudio).toBe(true);

    await native.command('mute');
    expect(run).toHaveBeenCalledWith('/usr/bin/wpctl', ['set-mute', '@DEFAULT_AUDIO_SINK@', '1']);

    await native.command('restore');
    expect(run).toHaveBeenCalledWith('/usr/bin/wpctl', ['set-mute', '@DEFAULT_AUDIO_SINK@', '0']);
  });
});
