import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LinuxNative, formatSwhkdConfig, type LinuxCommand } from '../src/main/platform/linux-native';
import { defaultPreferences, validatePreferences } from '../src/shared/preferences';

const scratch: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(scratch.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

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
    vi.stubEnv('XDG_CURRENT_DESKTOP', ''); vi.stubEnv('XDG_SESSION_DESKTOP', ''); vi.stubEnv('NIRI_SOCKET', '');
    vi.stubEnv('KDE_FULL_SESSION', ''); vi.stubEnv('GNOME_DESKTOP_SESSION_ID', ''); vi.stubEnv('HYPRLAND_INSTANCE_SIGNATURE', ''); vi.stubEnv('SWAYSOCK', '');
    const run = vi.fn<LinuxCommand>().mockResolvedValue('previous');
    const fallback = vi.fn();
    const native = new LinuxNative(run, async name => ['wl-copy', 'wl-paste'].includes(name) ? `/usr/bin/${name}` : undefined);
    await native.start();
    expect(native.capabilities()).toMatchObject({ globalShortcut: true, pushToTalk: false, automaticPaste: false, directTyping: false, muteAudio: false });
    expect(native.capabilities().linux).toMatchObject({ compositor: 'unknown', hotkeyBackend: 'compositor', portal: 'unknown' });
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
    expect(native.capabilities()).toMatchObject({ automaticPaste: true, directTyping: true, globalShortcut: true });

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
    const run = vi.fn<LinuxCommand>().mockImplementation(async (file) => file === 'pgrep' ? '123\n' : '');
    const native = new LinuxNative(run, async name => ['wl-copy', 'wl-paste', 'ydotool'].includes(name) ? `/usr/bin/${name}` : undefined,
      undefined, async path => path.endsWith('.ydotool_socket'));
    await native.start();
    expect(native.capabilities()).toMatchObject({ automaticPaste: true, directTyping: true });
    expect(native.capabilities().linux?.pasteBackend).toBe('ydotool');

    await native.command('key', 'ctrl-v');
    expect(run).toHaveBeenCalledWith('/usr/bin/ydotool', ['key', '29:1', '47:1', '47:0', '29:0']);

    await native.command('type', Buffer.from('abc').toString('base64'));
    expect(run).toHaveBeenCalledWith('/usr/bin/wl-copy', ['--type', 'text/plain;charset=utf-8'], { input: 'abc', quiet: true });
  });

  it('falls back to dotool on Wayland when wtype and ydotool are absent', async () => {
    vi.stubEnv('XDG_SESSION_TYPE', 'wayland'); vi.stubEnv('WAYLAND_DISPLAY', 'wayland-0');
    const run = vi.fn<LinuxCommand>().mockResolvedValue('');
    const native = new LinuxNative(run, async name => ['wl-copy', 'wl-paste', 'dotool'].includes(name) ? `/usr/bin/${name}` : undefined,
      undefined, async () => true, async () => true);
    await native.start();
    expect(native.capabilities()).toMatchObject({ automaticPaste: true, directTyping: true });

    await native.command('key', 'ctrl-v');
    expect(run).toHaveBeenCalledWith('/usr/bin/dotool', [], { input: 'key ctrl+v\n' });
  });

  it('generates valid swhkd config with press and @release bindings', () => {
    const config = formatSwhkdConfig('Control+Shift+Space', '/usr/bin/vokeyra');
    expect(config).toContain("control + shift + space\n\t'/usr/bin/vokeyra' --press");
    expect(config).toContain("control + shift + @space\n\t'/usr/bin/vokeyra' --release");

    const singleKey = formatSwhkdConfig('F8', '/opt/Vokeyra/vokeyra');
    expect(singleKey).toContain("f8\n\t'/opt/Vokeyra/vokeyra' --press");
    expect(singleKey).toContain("@f8\n\t'/opt/Vokeyra/vokeyra' --release");
    expect(formatSwhkdConfig('F8', "/tmp/it's $(unsafe)`app`")).toContain("'/tmp/it'\\''s $(unsafe)`app`' --press");
  });

  it('manages system audio mute and restore via pactl', async () => {
    vi.stubEnv('XDG_SESSION_TYPE', 'wayland'); vi.stubEnv('WAYLAND_DISPLAY', 'wayland-0');
    const run = vi.fn<LinuxCommand>().mockImplementation(async (_cmd, args) => {
      if (args[0] === 'get-default-sink') return 'speakers\n';
      if (args[0] === 'get-sink-mute') return 'Mute: no\n';
      return '';
    });
    const native = new LinuxNative(run, async name => name === 'pactl' ? `/usr/bin/${name}` : undefined);
    await native.start();
    expect(native.capabilities().muteAudio).toBe(true);

    await native.command('mute');
    expect(run).toHaveBeenCalledWith('/usr/bin/pactl', ['get-sink-mute', 'speakers']);
    expect(run).toHaveBeenCalledWith('/usr/bin/pactl', ['set-sink-mute', 'speakers', '1']);

    await native.command('restore');
    expect(run).toHaveBeenCalledWith('/usr/bin/pactl', ['set-sink-mute', 'speakers', '0']);
  });

  it('does not unmute if the audio was already muted prior to recording', async () => {
    vi.stubEnv('XDG_SESSION_TYPE', 'wayland'); vi.stubEnv('WAYLAND_DISPLAY', 'wayland-0');
    const run = vi.fn<LinuxCommand>().mockImplementation(async (_cmd, args) => {
      if (args[0] === 'get-default-sink') return 'speakers';
      if (args[0] === 'get-sink-mute') return 'Mute: yes\n';
      return '';
    });
    const native = new LinuxNative(run, async name => name === 'pactl' ? `/usr/bin/${name}` : undefined);
    await native.start();

    await native.command('mute');
    expect(run).toHaveBeenCalledTimes(2);

    await native.command('restore');
    // Restore should not unmute since it was already muted
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('manages system audio mute and restore via wpctl', async () => {
    vi.stubEnv('XDG_SESSION_TYPE', 'wayland'); vi.stubEnv('WAYLAND_DISPLAY', 'wayland-0');
    const run = vi.fn<LinuxCommand>().mockImplementation(async (_cmd, args) => {
      if (args[0] === 'inspect') return 'id 42, type PipeWire:Interface:Node\n  object.serial = "100"\n';
      if (args[0] === 'get-volume') return 'Volume: 0.75\n';
      return '';
    });
    const native = new LinuxNative(run, async name => name === 'wpctl' ? `/usr/bin/${name}` : undefined);
    await native.start();
    expect(native.capabilities().muteAudio).toBe(true);

    await native.command('mute');
    expect(run).toHaveBeenCalledWith('/usr/bin/wpctl', ['set-mute', '42', '1']);

    await native.command('restore');
    expect(run).toHaveBeenCalledWith('/usr/bin/wpctl', ['set-mute', '42', '0']);
  });

  it.each(['unconfigured', 'stopped', 'denied', 'connected'] as const)('only registers a connected and reloadable swhkd daemon: %s', async mode => {
    vi.stubEnv('XDG_SESSION_TYPE', 'wayland');
    const root = await mkdtemp(join(tmpdir(), 'vokeyra-hotkey-'));
    scratch.push(root);
    const generated = join(root, 'swhkdrc');
    const run = vi.fn<LinuxCommand>().mockImplementation(async (file) => {
      if (file === 'pgrep') return mode === 'stopped' ? '' : '123\n';
      if (mode === 'denied') throw new Error('Operation not permitted');
      return '';
    });
    const readText = vi.fn(async (path: string) => {
      if (path === '/proc/123/cmdline') return '/usr/bin/swhkd\0-c\0/config/swhkdrc\0';
      if (path === '/config/swhkdrc') return mode === 'unconfigured' ? '# unrelated bindings' : `include ${generated}\n`;
      throw new Error('missing');
    });
    const native = new LinuxNative(run, async name => name === 'swhkd' ? '/usr/bin/swhkd' : undefined, readText);
    await native.start();
    expect(await native.syncHotkey('Control+Space', root, '/usr/bin/vokeyra')).toBe(mode === 'connected');
    if (mode === 'unconfigured' || mode === 'stopped') expect(run).not.toHaveBeenCalledWith('kill', expect.anything());
    else expect(run).toHaveBeenCalledWith('kill', ['-HUP', '123']);
  });

  it('does not register a shortcut when its generated configuration cannot be written', async () => {
    vi.stubEnv('XDG_SESSION_TYPE', 'wayland');
    const root = await mkdtemp(join(tmpdir(), 'vokeyra-hotkey-'));
    scratch.push(root);
    const run = vi.fn<LinuxCommand>();
    const native = new LinuxNative(run, async name => name === 'swhkd' ? '/usr/bin/swhkd' : undefined);
    await native.start();
    await expect(native.syncHotkey('F8', join(root, 'missing'), '/usr/bin/vokeyra')).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });

  it('restores the original sink after the default device changes, including repeated mute requests', async () => {
    vi.stubEnv('XDG_SESSION_TYPE', 'wayland');
    let defaultSink = 'speakers';
    const muted: Record<string, boolean> = { speakers: false, headphones: true };
    const run: LinuxCommand = async (_file, args) => {
      if (args[0] === 'get-default-sink') return defaultSink;
      if (args[0] === 'get-sink-mute') return `Mute: ${muted[args[1]!] ? 'yes' : 'no'}`;
      if (args[0] === 'set-sink-mute') muted[args[1]!] = args[2] === '1';
      return '';
    };
    const native = new LinuxNative(run, async name => name === 'pactl' ? '/usr/bin/pactl' : undefined);
    await native.start();
    await native.command('mute');
    await native.command('mute');
    defaultSink = 'headphones';
    await native.command('restore');
    expect(muted).toEqual({ speakers: false, headphones: true });
  });

  it('retains the audio lease after a failed restore so shutdown can retry', async () => {
    vi.stubEnv('XDG_SESSION_TYPE', 'wayland');
    let failures = 1;
    const run = vi.fn<LinuxCommand>().mockImplementation(async (_file, args) => {
      if (args[0] === 'get-default-sink') return 'speakers';
      if (args[0] === 'get-sink-mute') return 'Mute: no';
      if (args[0] === 'set-sink-mute' && args[2] === '0' && failures-- > 0) throw new Error('Temporary failure');
      return '';
    });
    const native = new LinuxNative(run, async name => name === 'pactl' ? '/usr/bin/pactl' : undefined);
    await native.start();
    await native.command('mute');
    await expect(native.command('restore')).rejects.toThrow('Temporary failure');
    await native.command('restore');
    expect(run.mock.calls.filter(([, args]) => args[0] === 'set-sink-mute' && args[2] === '0')).toHaveLength(2);
  });

  it('never changes audio mute when the previous state could not be read', async () => {
    vi.stubEnv('XDG_SESSION_TYPE', 'wayland');
    const run = vi.fn<LinuxCommand>().mockImplementation(async (_file, args) => {
      if (args[0] === 'get-default-sink') return 'speakers';
      throw new Error('Audio server unavailable');
    });
    const native = new LinuxNative(run, async name => name === 'pactl' ? '/usr/bin/pactl' : undefined);
    await native.start();
    await expect(native.command('mute')).rejects.toThrow('unavailable');
    await native.command('restore');
    expect(run.mock.calls.some(([, args]) => args[0] === 'set-sink-mute')).toBe(false);
  });

  it('does not unmute a different PipeWire device that reused the same numeric ID', async () => {
    vi.stubEnv('XDG_SESSION_TYPE', 'wayland');
    let serial = '100';
    const run = vi.fn<LinuxCommand>().mockImplementation(async (_file, args) => {
      if (args[0] === 'inspect') return `id 42, type PipeWire:Interface:Node\n  object.serial = "${serial}"\n`;
      if (args[0] === 'get-volume') return 'Volume: 0.75';
      return '';
    });
    const native = new LinuxNative(run, async name => name === 'wpctl' ? '/usr/bin/wpctl' : undefined);
    await native.start();
    await native.command('mute');
    serial = '200';
    await native.command('restore');
    expect(run).not.toHaveBeenCalledWith('/usr/bin/wpctl', ['set-mute', '42', '0']);
  });

  it('does not claim a working ydotool when the daemon socket and process are missing', async () => {
    vi.stubEnv('XDG_SESSION_TYPE', 'wayland'); vi.stubEnv('WAYLAND_DISPLAY', 'wayland-0');
    const run = vi.fn<LinuxCommand>().mockResolvedValue('');
    const native = new LinuxNative(run, async name => ['wl-copy', 'wl-paste', 'ydotool'].includes(name) ? `/usr/bin/${name}` : undefined,
      undefined, async () => false);
    await native.start();
    const capabilities = native.capabilities();
    expect(capabilities.automaticPaste).toBe(false);
    expect(capabilities.linux?.integrations.find(item => item.id === 'paste')).toMatchObject({ state: 'setup' });
    await expect(native.command('key', 'ctrl-v')).rejects.toThrow('недоступна');
  });

  it('never retries a partially attempted wtype input through the clipboard', async () => {
    vi.stubEnv('XDG_SESSION_TYPE', 'wayland'); vi.stubEnv('WAYLAND_DISPLAY', 'wayland-0');
    const run = vi.fn<LinuxCommand>().mockImplementation(async (file, args) => {
      if (file.endsWith('wtype')) throw new Error('virtual keyboard disconnected');
      if (args[0] === 'get-volume') return '';
      return '';
    });
    const native = new LinuxNative(run, async name => ['wl-copy', 'wl-paste', 'wtype', 'ydotool']
      .includes(name) ? `/usr/bin/${name}` : undefined, undefined, async () => true);
    await native.start();
    await expect(native.command('type', Buffer.from('текст').toString('base64'))).rejects.toThrow('Текст сохранён в истории');
    expect(run.mock.calls.filter(([file]) => file.endsWith('wl-copy'))).toHaveLength(0);
    expect(run.mock.calls.filter(([file]) => file.endsWith('ydotool'))).toHaveLength(0);
    expect(native.capabilities().linux?.integrations.find(item => item.id === 'paste')?.state).toBe('error');
  });

  it('switches to a working backend only when the first one never started, then re-diagnoses', async () => {
    vi.stubEnv('XDG_SESSION_TYPE', 'wayland'); vi.stubEnv('WAYLAND_DISPLAY', 'wayland-0');
    vi.stubEnv('XDG_CURRENT_DESKTOP', ''); vi.stubEnv('XDG_SESSION_DESKTOP', ''); vi.stubEnv('KDE_FULL_SESSION', '');
    const run = vi.fn<LinuxCommand>().mockImplementation(async (file) => {
      if (file === 'pgrep') return '123\n';
      if (file.endsWith('wtype')) {
        const error = new Error('spawn wtype ENOENT') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      }
      return '';
    });
    const native = new LinuxNative(run, async name => ['wl-copy', 'wl-paste', 'wtype', 'ydotool']
      .includes(name) ? `/usr/bin/${name}` : undefined, undefined, async () => true);
    await native.start();
    await expect(native.command('key', 'ctrl-v')).resolves.toBe('');
    expect(run.mock.calls.filter(([file]) => file.endsWith('wtype'))).toHaveLength(1);
    expect(run.mock.calls.filter(([file]) => file.endsWith('ydotool'))).toHaveLength(1);
    expect(native.capabilities().linux?.pasteBackend).toBe('ydotool');
    await native.recheck({ mode: 'layer-shell', layerShell: true });
    expect(native.capabilities().linux?.pasteBackend).toBe('wtype');
  });

  it('prefers ydotool on KDE/GNOME and wtype on wlroots for reliable insertion', async () => {
    vi.stubEnv('XDG_SESSION_TYPE', 'wayland'); vi.stubEnv('WAYLAND_DISPLAY', 'wayland-0');
    const run = vi.fn<LinuxCommand>().mockImplementation(async file => file === 'pgrep' ? '123\n' : '');
    const find = async (name: string) => ['wl-copy', 'wl-paste', 'wtype', 'ydotool'].includes(name) ? `/usr/bin/${name}` : undefined;
    const kde = new LinuxNative(run, find, undefined, async () => true);
    vi.stubEnv('XDG_CURRENT_DESKTOP', 'KDE'); vi.stubEnv('KDE_FULL_SESSION', 'true');
    await kde.start();
    expect(kde.capabilities().linux?.pasteBackend).toBe('ydotool');

    vi.stubEnv('XDG_CURRENT_DESKTOP', 'niri'); vi.stubEnv('KDE_FULL_SESSION', ''); vi.stubEnv('NIRI_SOCKET', '/run/user/1000/niri.sock');
    const niri = new LinuxNative(run, find, undefined, async () => true);
    await niri.start();
    expect(niri.capabilities().linux?.pasteBackend).toBe('wtype');
  });

  it('detects the compositor and the GlobalShortcuts portal without claiming portal registration', async () => {
    vi.stubEnv('XDG_SESSION_TYPE', 'wayland'); vi.stubEnv('WAYLAND_DISPLAY', 'wayland-0');
    vi.stubEnv('NIRI_SOCKET', '/run/user/1000/niri.sock'); vi.stubEnv('XDG_CURRENT_DESKTOP', 'niri');
    const run = vi.fn<LinuxCommand>().mockImplementation(async (file, args) => {
      if (file.endsWith('busctl') && args[0] === '--user') return 'interface org.freedesktop.portal.GlobalShortcuts';
      return '';
    });
    const native = new LinuxNative(run, async name => name === 'busctl' ? '/usr/bin/busctl' : undefined);
    await native.start();
    const capabilities = native.capabilities();
    expect(capabilities.linux).toMatchObject({ compositor: 'niri', portal: 'available', hotkeyBackend: 'compositor' });
    expect(capabilities.pushToTalk).toBe(false);
    expect(capabilities.linux?.hotkeyHint).toContain('vokeyra');
    expect(capabilities.linux?.integrations.find(item => item.id === 'hotkey')?.state).toBe('setup');
  });

  it.each(['previous text', ''])('restores the X11 clipboard through the host bridge: %j', async previous => {
    vi.stubEnv('XDG_SESSION_TYPE', 'x11'); vi.stubEnv('WAYLAND_DISPLAY', ''); vi.stubEnv('DISPLAY', ':1');
    const run = vi.fn<LinuxCommand>();
    const native = new LinuxNative(run, async () => undefined);
    await native.start();
    const write = vi.fn().mockResolvedValue(undefined);
    expect(await native.restoreClipboard('dictated', previous, async () => 'dictated', write)).toBe(true);
    expect(write).toHaveBeenCalledWith(previous);
    expect(run).not.toHaveBeenCalled();
  });

  it('does not restore the X11 clipboard after the user changed it', async () => {
    vi.stubEnv('XDG_SESSION_TYPE', 'x11'); vi.stubEnv('WAYLAND_DISPLAY', ''); vi.stubEnv('DISPLAY', ':1');
    const run = vi.fn<LinuxCommand>();
    const native = new LinuxNative(run, async () => undefined);
    await native.start();
    const write = vi.fn().mockResolvedValue(undefined);
    await expect(native.restoreClipboard('dictated', 'previous', async () => 'new user text', write)).resolves.toBe(false);
    expect(write).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it.each(['previous text', ''])('restores the clipboard after failed Wayland typing, including an empty clipboard: %j', async previous => {
    vi.stubEnv('XDG_SESSION_TYPE', 'wayland');
    let clipboard = previous;
    const run: LinuxCommand = async (file, _args, options) => {
      if (file === 'pgrep') return '123\n';
      if (file.endsWith('wl-paste')) return clipboard;
      if (file.endsWith('wl-copy')) { clipboard = options!.input!; return ''; }
      throw new Error('ydotool daemon unavailable');
    };
    const native = new LinuxNative(run, async name => ['wl-copy', 'wl-paste', 'ydotool'].includes(name) ? `/usr/bin/${name}` : undefined,
      undefined, async path => path.endsWith('.ydotool_socket'));
    await native.start();
    await expect(native.command('type', Buffer.from('dictated text').toString('base64'))).rejects.toThrow('daemon unavailable');
    expect(clipboard).toBe(previous);
  });
});
