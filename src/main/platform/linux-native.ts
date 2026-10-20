import { spawn } from 'node:child_process';
import { access, constants, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import type { DesktopCapabilities } from '../../shared/contracts';

type CommandOptions = { input?: string; quiet?: boolean; timeout?: number };
export type LinuxCommand = (file: string, args: string[], options?: CommandOptions) => Promise<string>;

// Arguments and dictated text never pass through a shell. Clipboard tools fork
// in the background, so their inherited stdout/stderr must not be pipe handles.
export const runLinuxCommand: LinuxCommand = (file, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(file, args, { shell: false, env: { ...process.env, LC_ALL: 'C' },
    stdio: ['pipe', options.quiet ? 'ignore' : 'pipe', options.quiet ? 'ignore' : 'pipe'] });
  let output = '', errors = '';
  const timer = setTimeout(() => { child.kill(); reject(new Error('Системная команда Linux не отвечает.')); }, options.timeout ?? 5000);
  child.stdout?.on('data', data => { output = (output + data).slice(-1_000_000); });
  child.stderr?.on('data', data => { errors = (errors + data).slice(-2000); });
  child.once('error', error => { clearTimeout(timer); reject(error); });
  child.once('close', code => {
    clearTimeout(timer);
    if (code === 0) resolve(output);
    else reject(new Error(`Системный модуль Linux: ${errors.trim() || `${file} (${code})`}`));
  });
  child.stdin!.on('error', () => {});
  child.stdin!.end(options.input ?? '');
});

async function executable(name: string): Promise<string | undefined> {
  for (const directory of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const path = join(directory, name);
    if (await access(path, constants.X_OK).then(() => true).catch(() => false)) return path;
  }
}

export function formatSwhkdConfig(hotkey: string, executablePath: string): string {
  const parts = hotkey.split('+');
  const rawKey = parts.pop()!;
  const keyMap: Record<string, string> = {
    Space: 'space', Enter: 'Return', Escape: 'Escape', Tab: 'Tab', Backspace: 'BackSpace',
    Delete: 'Delete', Insert: 'Insert', Capslock: 'Caps_Lock', PageUp: 'Prior', PageDown: 'Next',
    Home: 'Home', End: 'End', Up: 'Up', Down: 'Down', Left: 'Left', Right: 'Right',
    Plus: 'plus', '-': 'minus', '=': 'equal', '[': 'bracketleft', ']': 'bracketright',
    ';': 'semicolon', "'": 'apostrophe', ',': 'comma', '.': 'period', '/': 'slash',
    '\\': 'backslash', '`': 'grave',
  };
  const modMap: Record<string, string> = {
    Control: 'control', CommandOrControl: 'control', Shift: 'shift', Alt: 'alt', Super: 'super',
  };
  const key = keyMap[rawKey] ?? rawKey.toLowerCase();
  const mods = parts.map(p => modMap[p] ?? p.toLowerCase());
  const combo = [...mods, key].join(' + ');
  const release = [...mods, `@${key}`].join(' + ');
  // swhkd executes its command through a shell, unlike the Linux tool calls below.
  const exe = `'${executablePath.replaceAll("'", "'\\''")}'`;
  return `# Vokeyra hotkey configuration for swhkd\n${combo}\n\t${exe} --press\n\n${release}\n\t${exe} --release\n`;
}

export class LinuxNative {
  readonly session = process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY ? 'wayland' : process.env.DISPLAY ? 'x11' : 'unknown';
  private tools: Record<string, string | undefined> = {};
  private mutedSink?: { tool: string; id: string; serial?: string };

  constructor(private run: LinuxCommand = runLinuxCommand, private find = executable,
    private readText = (path: string): Promise<string> => readFile(path, 'utf8')) {}

  capabilities(): DesktopCapabilities {
    const x11 = this.session === 'x11';
    const wayland = this.session === 'wayland';
    const hasWaylandPaste = wayland && Boolean(this.tools.wtype || this.tools.ydotool || this.tools.dotool);
    const hasWaylandDirect = wayland && Boolean(this.tools.wtype || this.tools.ydotool || this.tools.dotool);
    const hasHotkey = x11 || Boolean(wayland && this.tools.swhkd);
    const hasAudioMute = Boolean(this.tools.wpctl || this.tools.pactl);

    let warning: string | undefined;
    if (wayland) {
      if (!hasWaylandPaste) {
        warning = 'В Wayland запись запускается кнопкой. Результат копируется в буфер обмена.';
      } else {
        warning = 'В Wayland для глобальной клавиши настройте swhkd или хоткей композитора на vokeyra --toggle.';
      }
    } else if (x11 && !this.tools.xdotool) {
      warning = 'Для автоматической вставки в Linux установите xdotool.';
    }

    return {
      platform: 'linux',
      session: this.session,
      globalShortcut: hasHotkey,
      pushToTalk: hasHotkey,
      muteAudio: hasAudioMute,
      automaticPaste: x11 ? !!this.tools.xdotool : hasWaylandPaste,
      directTyping: x11 ? !!this.tools.xdotool : hasWaylandDirect,
      warning,
    };
  }

  async start(): Promise<void> {
    const toolNames = ['xdotool', 'wl-copy', 'wl-paste', 'wtype', 'ydotool', 'dotool', 'wpctl', 'pactl', 'swhkd', 'swhks'];
    for (const name of toolNames) this.tools[name] = await this.find(name);
    if (this.session === 'wayland' && this.tools.wtype) {
      const works = await this.run(this.tools.wtype, ['-k', 'Shift_L']).then(() => true).catch(() => false);
      if (!works) delete this.tools.wtype;
    }
  }

  async clipboardWrite(text: string, fallback: (text: string) => Promise<void>): Promise<void> {
    if (this.session !== 'wayland') return fallback(text);
    if (!this.tools['wl-copy']) throw new Error('Для буфера обмена Wayland установите wl-clipboard.');
    await this.run(this.tools['wl-copy'], ['--type', 'text/plain;charset=utf-8'], { input: text, quiet: true });
  }

  async clipboardRead(fallback: () => Promise<string>): Promise<string> {
    if (this.session !== 'wayland') return fallback();
    if (!this.tools['wl-paste']) throw new Error('Для буфера обмена Wayland установите wl-clipboard.');
    // An empty or non-text clipboard has no previous text to restore.
    return this.run(this.tools['wl-paste'], ['--no-newline', '--type', 'text']).catch(() => '');
  }

  async syncHotkey(hotkey: string, dataPath?: string, executablePath?: string): Promise<boolean> {
    if (this.session !== 'wayland' || !dataPath || !executablePath) return false;
    const generated = join(dataPath, 'swhkdrc');
    await writeFile(generated, formatSwhkdConfig(hotkey, executablePath), 'utf8');
    if (!this.tools.swhkd) return false;
    const pids = await this.run('pgrep', ['-x', 'swhkd']).catch(() => '');
    for (const pid of pids.trim().split(/\s+/).filter(value => /^\d+$/.test(value))) {
      try {
        const argv = (await this.readText(`/proc/${pid}/cmdline`)).split('\0');
        const flag = argv.findIndex(arg => arg === '-c' || arg === '--config');
        const explicit = flag >= 0 ? argv[flag + 1] : argv.find(arg => arg.startsWith('--config='))?.slice(9);
        const candidates = explicit ? [explicit] : [join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'swhkd', 'swhkdrc'), '/etc/swhkd/swhkdrc'];
        let connected = false;
        for (const path of candidates) {
          if (!path || !isAbsolute(path)) continue;
          let contents: string;
          try { contents = await this.readText(path); } catch { continue; }
          connected = resolve(path) === resolve(generated) || contents.split(/\r?\n/).some(line => line.trim() === `include ${generated}`);
          break; // Only the first existing default config is used by swhkd.
        }
        if (!connected) continue;
        await this.run('kill', ['-HUP', pid]);
        return true;
      } catch { /* Missing configuration, stopped daemon, or insufficient permission. */ }
    }
    return false;
  }

  async command(command: 'key' | 'type' | 'mute' | 'restore', argument = ''): Promise<string> {
    if (command === 'mute') {
      if (this.mutedSink) return '';
      if (this.tools.pactl) {
        const id = (await this.run(this.tools.pactl, ['get-default-sink'])).trim();
        if (!id || id.startsWith('@')) throw new Error('Не удалось определить устройство вывода звука.');
        const state = await this.run(this.tools.pactl, ['get-sink-mute', id]);
        if (!/^Mute:\s*(yes|no)\s*$/i.test(state.trim())) throw new Error('Не удалось определить состояние звука.');
        if (/\byes\b/i.test(state)) return '';
        this.mutedSink = { tool: this.tools.pactl, id };
        await this.run(this.tools.pactl, ['set-sink-mute', id, '1']);
        return '';
      }
      if (this.tools.wpctl) {
        const info = await this.run(this.tools.wpctl, ['inspect', '@DEFAULT_AUDIO_SINK@']);
        const id = info.match(/^id\s+(\d+),/m)?.[1];
        const serial = info.match(/object\.serial\s*=\s*"(\d+)"/)?.[1];
        if (!id || !serial) throw new Error('Не удалось определить устройство вывода звука.');
        const state = await this.run(this.tools.wpctl, ['get-volume', id]);
        if (!state.startsWith('Volume:')) throw new Error('Не удалось определить состояние звука.');
        if (state.includes('[MUTED]')) return '';
        this.mutedSink = { tool: this.tools.wpctl, id, serial };
        await this.run(this.tools.wpctl, ['set-mute', id, '1']);
        return '';
      }
      throw new Error('Отключение системного звука недоступно в вашей системе.');
    }

    if (command === 'restore') {
      const sink = this.mutedSink;
      if (!sink) return '';
      if (sink.serial) {
        const info = await this.run(sink.tool, ['inspect', sink.id]);
        if (info.match(/object\.serial\s*=\s*"(\d+)"/)?.[1] !== sink.serial) {
          this.mutedSink = undefined;
          return ''; // PipeWire may reuse the numeric ID after a device disconnects.
        }
      }
      await this.run(sink.tool, [sink.serial ? 'set-mute' : 'set-sink-mute', sink.id, '0']);
      this.mutedSink = undefined; // Keep the lease if restoration fails, so shutdown can retry.
      return '';
    }

    // Key combination validation must happen first
    const allowedKeys = ['ctrl-v', 'ctrl-shift-v', 'shift-insert', 'enter', 'ctrl-enter'];
    if (command === 'key' && !allowedKeys.includes(argument)) {
      throw new Error('Неподдерживаемое сочетание клавиш.');
    }

    const x11 = this.session === 'x11';
    const wayland = this.session === 'wayland';

    if (x11) {
      const tool = this.tools.xdotool;
      if (!tool) throw new Error('Автоматическая вставка недоступна. Текст сохранён в истории.');
      if (command === 'type') {
        return this.run(tool, ['type', '--clearmodifiers', '--delay', '0', '--file', '-'], {
          input: Buffer.from(argument, 'base64').toString('utf8'), timeout: 30_000,
        });
      }
      const keys: Record<string, string> = {
        'ctrl-v': 'ctrl+v', 'ctrl-shift-v': 'ctrl+shift+v', 'shift-insert': 'shift+Insert',
        enter: 'Return', 'ctrl-enter': 'ctrl+Return',
      };
      return this.run(tool, ['key', '--clearmodifiers', keys[argument]!]);
    }

    if (wayland) {
      if (command === 'type') {
        const text = Buffer.from(argument, 'base64').toString('utf8');
        if (this.tools.wtype) {
          try {
            return await this.run(this.tools.wtype, ['-'], { input: text, timeout: 30_000 });
          } catch {
            delete this.tools.wtype;
          }
        }

        if (this.tools.ydotool || this.tools.dotool) {
          const prev = await this.clipboardRead(() => Promise.resolve('')).catch(() => '');
          try {
            await this.clipboardWrite(text, () => Promise.resolve());
            await new Promise(resolve => setTimeout(resolve, 45));
            await this.command('key', 'ctrl-v');
            await new Promise(resolve => setTimeout(resolve, 160));
          } finally {
            await this.clipboardWrite(prev, () => Promise.resolve());
          }
          return '';
        }

        throw new Error('Автоматическая вставка недоступна. Текст сохранён в истории.');
      }

      // command === 'key' on Wayland
      if (this.tools.wtype) {
        try {
          const wtypeArgs: Record<string, string[]> = {
            'ctrl-v': ['-M', 'ctrl', '-k', 'v', '-m', 'ctrl'],
            'ctrl-shift-v': ['-M', 'ctrl', '-M', 'shift', '-k', 'v', '-m', 'shift', '-m', 'ctrl'],
            'shift-insert': ['-M', 'shift', '-k', 'Insert', '-m', 'shift'],
            enter: ['-k', 'Return'],
            'ctrl-enter': ['-M', 'ctrl', '-k', 'Return', '-m', 'ctrl'],
          };
          return await this.run(this.tools.wtype, wtypeArgs[argument]!);
        } catch {
          delete this.tools.wtype;
        }
      }

      if (this.tools.ydotool) {
        const ydotoolArgs: Record<string, string[]> = {
          'ctrl-v': ['key', '29:1', '47:1', '47:0', '29:0'],
          'ctrl-shift-v': ['key', '29:1', '42:1', '47:1', '47:0', '42:0', '29:0'],
          'shift-insert': ['key', '42:1', '110:1', '110:0', '42:0'],
          enter: ['key', '28:1', '28:0'],
          'ctrl-enter': ['key', '29:1', '28:1', '28:0', '29:0'],
        };
        return this.run(this.tools.ydotool, ydotoolArgs[argument]!);
      }

      if (this.tools.dotool) {
        const dotoolInput: Record<string, string> = {
          'ctrl-v': 'key ctrl+v\n',
          'ctrl-shift-v': 'key ctrl+shift+v\n',
          'shift-insert': 'key shift+insert\n',
          enter: 'key enter\n',
          'ctrl-enter': 'key ctrl+enter\n',
        };
        return this.run(this.tools.dotool, [], { input: dotoolInput[argument]! });
      }

      throw new Error('Автоматическая вставка недоступна. Текст сохранён в истории.');
    }

    throw new Error('Автоматическая вставка недоступна. Текст сохранён в истории.');
  }
}
