import { spawn } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
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

export class LinuxNative {
  readonly session = process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY ? 'wayland' : process.env.DISPLAY ? 'x11' : 'unknown';
  private tools: Record<string, string | undefined> = {};
  constructor(private run: LinuxCommand = runLinuxCommand, private find = executable) {}
  capabilities(): DesktopCapabilities {
    const x11 = this.session === 'x11';
    return { platform: 'linux', session: this.session, globalShortcut: x11,
      pushToTalk: x11, muteAudio: false,
      automaticPaste: x11 && !!this.tools.xdotool, directTyping: x11 && !!this.tools.xdotool,
      warning: this.session === 'wayland' ? 'В Wayland горячая клавиша недоступна. Для записи откройте «История» и нажмите «Начать запись». Результат копируется в буфер обмена.'
        : !this.tools.xdotool ? 'Для автоматической вставки в Linux установите xdotool.' : undefined };
  }
  async start(): Promise<void> {
    for (const name of ['xdotool', 'wl-copy', 'wl-paste']) this.tools[name] = await this.find(name);
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
  async command(command: 'key' | 'type', argument: string): Promise<string> {
    const tool = this.tools.xdotool;
    if (this.session !== 'x11' || !tool) throw new Error('Автоматическая вставка недоступна. Текст сохранён в истории.');
    if (command === 'type') return this.run(tool, ['type', '--clearmodifiers', '--delay', '0', '--file', '-'], {
      input: Buffer.from(argument, 'base64').toString('utf8'), timeout: 30_000,
    });
    const keys: Record<string, string> = { 'ctrl-v': 'ctrl+v', 'ctrl-shift-v': 'ctrl+shift+v', 'shift-insert': 'shift+Insert', enter: 'Return', 'ctrl-enter': 'ctrl+Return' };
    const key = keys[argument];
    if (!key) throw new Error('Неподдерживаемое сочетание клавиш.');
    return this.run(tool, ['key', '--clearmodifiers', key]);
  }
}
