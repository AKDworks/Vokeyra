import { spawn } from 'node:child_process';
import { access, constants, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import type {
  DesktopCapabilities, LinuxCompositor, LinuxDesktopInfo, LinuxIntegrationId,
  LinuxIntegrationState, LinuxIntegrationStatus, LinuxOverlayInfo,
} from '../../shared/contracts';

type CommandOptions = { input?: string; quiet?: boolean; timeout?: number };
export type LinuxCommand = (file: string, args: string[], options?: CommandOptions) => Promise<string>;
export type OverlayProbe = Partial<LinuxOverlayInfo>;
export type PasteBackend = 'wtype' | 'ydotool' | 'dotool';

// Arguments and dictated text never pass through a shell. Clipboard tools fork
// in the background, so their inherited stdout/stderr must not be pipe handles.
export const runLinuxCommand: LinuxCommand = (file, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(file, args, { shell: false, env: { ...process.env, LC_ALL: 'C' },
    stdio: ['pipe', options.quiet ? 'ignore' : 'pipe', options.quiet ? 'ignore' : 'pipe'] });
  let output = '', errors = '';
  const timer = setTimeout(() => { child.kill(); reject(new Error('Системная команда Linux не отвечает.')); }, options.timeout ?? 5000);
  child.stdout?.on('data', data => { output = (output + data).slice(-1_000_000); });
  child.stderr?.on('data', data => { errors = (errors + data).slice(-2000); });
  child.once('error', error => {
    clearTimeout(timer);
    (error as NodeJS.ErrnoException).message ||= `${file}: ${error.message}`;
    reject(error);
  });
  child.once('close', code => {
    clearTimeout(timer);
    if (code === 0) resolve(output);
    else {
      const error = new Error(`Системный модуль Linux: ${errors.trim() || `${file} (${code})`}`) as Error & { exitCode?: number };
      error.exitCode = code ?? undefined;
      reject(error);
    }
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

async function fileExists(path: string): Promise<boolean> {
  return access(path, constants.F_OK).then(() => true).catch(() => false);
}

async function writable(path: string): Promise<boolean> {
  return access(path, constants.R_OK | constants.W_OK).then(() => true).catch(() => false);
}

/** True when a command failed before it could touch the user's application. */
function neverRan(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'EACCES' || /no such file|not found/i.test(String((error as Error)?.message ?? error));
}

export function detectCompositor(env: NodeJS.ProcessEnv = process.env): LinuxCompositor {
  if (env.XDG_SESSION_TYPE === 'x11' || (!env.WAYLAND_DISPLAY && env.DISPLAY)) return 'unknown';
  const desktop = `${env.XDG_CURRENT_DESKTOP ?? ''}:${env.XDG_SESSION_DESKTOP ?? ''}`.toLowerCase();
  if (env.NIRI_SOCKET || desktop.includes('niri')) return 'niri';
  if (env.HYPRLAND_INSTANCE_SIGNATURE || desktop.includes('hyprland')) return 'hyprland';
  if (env.SWAYSOCK || desktop.includes('sway')) return 'sway';
  if (env.KDE_FULL_SESSION || desktop.includes('kde') || desktop.includes('plasma')) return 'kde';
  if (env.GNOME_DESKTOP_SESSION_ID || desktop.includes('gnome')) return 'gnome';
  return 'unknown';
}

const compositorNames: Record<LinuxCompositor, string> = {
  niri: 'niri', kde: 'KDE Plasma', gnome: 'GNOME', sway: 'Sway', hyprland: 'Hyprland', unknown: 'Неизвестный композитор',
};

function hotkeyHint(compositor: LinuxCompositor): string {
  switch (compositor) {
    case 'niri': return 'binds {\n    Mod+Shift+Space { spawn "vokeyra" "--toggle"; }\n}';
    case 'sway': return 'bindsym $mod+Shift+space exec vokeyra --toggle';
    case 'hyprland': return 'bind = SUPER SHIFT, SPACE, exec, vokeyra --toggle';
    case 'kde':
    case 'gnome':
    case 'unknown':
    default: return 'vokeyra --toggle';
  }
}

function integration(id: LinuxIntegrationId, state: LinuxIntegrationState,
  detail: string, action?: string): LinuxIntegrationStatus {
  return { id, state, detail, ...(action ? { action } : {}) };
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
  readonly compositor = detectCompositor();
  private tools: Record<string, string | undefined> = {};
  private broken = new Set<PasteBackend>();
  private mutedSink?: { tool: string; id: string; serial?: string };
  private hotkeyConnected = false;
  private hotkeyConfigPath?: string;
  private portal: 'available' | 'unavailable' | 'unknown' = 'unknown';
  private overlay: LinuxOverlayInfo = { mode: 'window', layerShell: false };
  private ydotoolReady = false;
  private dotoolReady = false;
  private diagnosticsDetail: Partial<Record<'ydotool' | 'dotool' | 'wtype', string>> = {};
  private lastPasteError?: string;

  constructor(private run: LinuxCommand = runLinuxCommand, private find = executable,
    private readText = (path: string): Promise<string> => readFile(path, 'utf8'),
    private exists = fileExists, private canWrite = writable) {}

  private pasteBackend(): PasteBackend | undefined {
    if (this.session !== 'wayland') return undefined;
    // KWin and Mutter do not reliably expose the virtual-keyboard protocol used
    // by wtype; ydotool is the documented path there. wtype remains first on
    // wlroots compositors (niri/Sway/Hyprland).
    const ydotoolFirst = this.compositor === 'kde' || this.compositor === 'gnome';
    const order: PasteBackend[] = ydotoolFirst
      ? ['ydotool', 'wtype', 'dotool'] : ['wtype', 'ydotool', 'dotool'];
    for (const backend of order) {
      if (backend === 'wtype' && this.tools.wtype && !this.broken.has('wtype')) return 'wtype';
      if (backend === 'ydotool' && this.tools.ydotool && this.ydotoolReady
        && !this.broken.has('ydotool') && this.tools['wl-copy'] && this.tools['wl-paste']) return 'ydotool';
      if (backend === 'dotool' && this.tools.dotool && this.dotoolReady
        && !this.broken.has('dotool') && this.tools['wl-copy'] && this.tools['wl-paste']) return 'dotool';
    }
    return undefined;
  }

  private ydotoolSocket(): string {
    const runtime = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() ?? 1000}`;
    return process.env.YDOTOOL_SOCKET || join(runtime, '.ydotool_socket');
  }

  private integrations(): LinuxIntegrationStatus[] {
    const x11 = this.session === 'x11';
    const wayland = this.session === 'wayland';
    const backend = this.pasteBackend();
    const hotkey: LinuxIntegrationStatus = x11
      ? integration('hotkey', 'active', 'Глобальная клавиша работает через X11.')
      : this.hotkeyConnected
        ? integration('hotkey', 'active', 'swhkd подключён к Vokeyra.')
        : integration('hotkey', 'setup',
          this.tools.swhkd
            ? 'swhkd найден, но не подключён к Vokeyra.'
            : this.portal === 'available'
              ? 'Портал GlobalShortcuts обнаружен, но Vokeyra пока использует привязку композитора.'
              : 'Wayland не разрешает приложению перехватывать клавиши. Назначьте команду в настройках композитора.',
          this.tools.swhkd
            ? 'Добавьте include сгенерированного swhkdrc в конфигурацию swhkd.'
            : 'Добавьте vokeyra --toggle как пользовательскую горячую клавишу или подключите swhkd.');
    const pushToTalk: LinuxIntegrationStatus = x11
      ? integration('pushToTalk', 'active', 'Удержание поддерживается в X11.')
      : this.hotkeyConnected
        ? integration('pushToTalk', 'active', 'Удержание работает через swhkd.')
        : this.compositor === 'niri'
          ? integration('pushToTalk', 'unavailable', 'niri не передаёт приложениям событие отпускания клавиши.', 'Используйте режим переключения или swhkd.')
          : this.compositor === 'sway' || this.compositor === 'hyprland'
            ? integration('pushToTalk', 'setup', 'Композитор умеет отдельные привязки нажатия и отпускания.', 'Добавьте vokeyra --press и vokeyra --release.')
            : integration('pushToTalk', 'setup', 'Для удержания нужен swhkd с обработкой отпускания.', 'Настройте swhkd или используйте режим переключения.');
    const paste: LinuxIntegrationStatus = x11
      ? this.tools.xdotool
        ? integration('paste', 'active', 'Вставка работает через xdotool.')
        : integration('paste', 'unavailable', 'Для вставки в X11 нужен xdotool.', 'Установите xdotool.')
      : !wayland
        ? integration('paste', 'unavailable', 'Система ввода не определена.', 'Запустите Vokeyra в сеансе X11 или Wayland.')
        : this.lastPasteError
          ? integration('paste', 'error', 'Инструмент ввода перестал работать.', 'Проверьте компонент и повторите проверку. Текст сохранён в истории.')
          : backend === 'wtype'
            ? integration('paste', 'ready', 'Найден wtype. Автоматическая проверка не отправляет клавиши в активное окно.')
            : backend === 'ydotool'
              ? integration('paste', 'ready', 'Найден ydotool с работающим демоном.')
              : backend === 'dotool'
                ? integration('paste', 'ready', 'Найден dotool.')
                : this.tools.ydotool && !this.ydotoolReady
                  ? integration('paste', 'setup', this.diagnosticsDetail.ydotool ?? 'ydotool установлен, но ydotoold не запущен.', 'Запустите ydotoold или проверьте YDOTOOL_SOCKET.')
                  : this.tools.dotool && !this.dotoolReady
                    ? integration('paste', 'setup', this.diagnosticsDetail.dotool ?? 'dotool не имеет доступа к устройствам ввода.', 'Проверьте права на /dev/uinput и /dev/input.')
                    : integration('paste', 'unavailable', 'Не найден рабочий инструмент ввода текста.', 'Установите wtype, ydotool с ydotoold или dotool.');
    const overlay: LinuxIntegrationStatus = this.overlay.mode === 'layer-shell'
      ? integration('overlay', 'active', 'Индикатор использует layer-shell и не участвует в раскладке.')
      : x11
        ? integration('overlay', 'active', 'Индикатор показан небольшим плавающим окном X11.')
        : integration('overlay', 'setup', this.overlay.reason ?? 'Индикатор показан обычным окном: композитор не предоставил layer-shell.', 'Добавьте правило для окна с заголовком Vokeyra Indicator.');
    return [hotkey, pushToTalk, paste, overlay];
  }

  capabilities(): DesktopCapabilities {
    const x11 = this.session === 'x11';
    const wayland = this.session === 'wayland';
    const backend = this.pasteBackend();
    const hasInput = x11 ? Boolean(this.tools.xdotool) : Boolean(backend);
    const linux: LinuxDesktopInfo = {
      compositor: this.compositor,
      compositorName: compositorNames[this.compositor],
      session: this.session === 'wayland' || this.session === 'x11' ? this.session : 'unknown',
      portal: this.portal,
      overlay: this.overlay,
      ...(x11 ? { pasteBackend: 'xdotool' as const } : backend ? { pasteBackend: backend } : {}),
      ...(x11 ? { hotkeyBackend: 'x11' as const } : this.hotkeyConnected ? { hotkeyBackend: 'swhkd' as const } : { hotkeyBackend: 'compositor' as const }),
      ...(wayland && !this.hotkeyConnected ? { hotkeyHint: hotkeyHint(this.compositor) } : {}),
      integrations: this.integrations(),
    };
    let warning: string | undefined;
    if (wayland && !hasInput) {
      warning = 'В Wayland запись запускается кнопкой. Результат копируется в буфер обмена.';
    } else if (wayland && !this.hotkeyConnected) {
      warning = 'В Wayland для глобальной клавиши настройте swhkd или хоткей композитора на vokeyra --toggle.';
    } else if (x11 && !this.tools.xdotool) {
      warning = 'Для автоматической вставки в Linux установите xdotool.';
    }

    return {
      platform: 'linux',
      // Native Wayland is still reported as Wayland: XWayland availability does
      // not change which input protocols the session actually provides.
      session: this.session,
      globalShortcut: x11 || wayland,
      // A compositor bind can only toggle. Push-to-talk needs a backend that
      // reports key release (X11 or swhkd).
      pushToTalk: x11 || (wayland && (this.hotkeyConnected || this.compositor === 'sway' || this.compositor === 'hyprland')),
      muteAudio: Boolean(this.tools.wpctl || this.tools.pactl),
      automaticPaste: hasInput,
      directTyping: hasInput,
      warning,
      linux,
    };
  }

  /** Re-run all cheap runtime probes. Never sends keystrokes to the user's windows. */
  async recheck(overlay?: OverlayProbe): Promise<void> {
    const toolNames = ['xdotool', 'wl-copy', 'wl-paste', 'wtype', 'ydotool', 'dotool', 'wpctl',
      'pactl', 'swhkd', 'swhks', 'busctl', 'gdbus'];
    for (const name of toolNames) this.tools[name] = await this.find(name);
    if (overlay) this.overlay = { mode: overlay.mode ?? 'window', layerShell: overlay.layerShell ?? false, ...(overlay.reason ? { reason: overlay.reason } : {}), ...(overlay.title ? { title: overlay.title } : {}) };
    this.broken.clear();
    this.lastPasteError = undefined;
    this.diagnosticsDetail = {};

    if (this.session === 'wayland') {
      if (this.tools.ydotool) {
        const socket = this.ydotoolSocket();
        const socketPresent = await this.exists(socket);
        const processRunning = await this.run('pgrep', ['-x', 'ydotoold'])
          .then(value => value.trim().length > 0).catch(() => false);
        // A stale socket alone does not prove that the daemon is alive.
        this.ydotoolReady = socketPresent && processRunning;
        if (!this.ydotoolReady) this.diagnosticsDetail.ydotool = 'ydotool установлен, но ydotoold не запущен или его сокет недоступен.';
      }
      if (this.tools.dotool) {
        this.dotoolReady = await this.canWrite('/dev/uinput') && await this.exists('/dev/input');
        if (!this.dotoolReady) this.diagnosticsDetail.dotool = 'dotool не имеет доступа к /dev/uinput и /dev/input.';
      }
      if (this.tools.wtype) this.diagnosticsDetail.wtype = 'wtype не проверяется автоматически: проверка отправила бы клавиши в активное окно.';
      this.portal = await this.probePortal();
      if (this.hotkeyConfigPath) {
        this.hotkeyConnected = await this.swhkdConnected(this.hotkeyConfigPath, false);
      }
    }
  }

  private async probePortal(): Promise<'available' | 'unavailable' | 'unknown'> {
    const attempts: Array<[string | undefined, string[]]> = [
      [this.tools.busctl, ['--user', '--no-pager', 'introspect', 'org.freedesktop.portal.Desktop', '/org/freedesktop/portal/desktop']],
      [this.tools.gdbus, ['introspect', '--session', '--dest', 'org.freedesktop.portal.Desktop', '--object-path', '/org/freedesktop/portal/desktop']],
    ];
    for (const [tool, args] of attempts) {
      if (!tool) continue;
      try {
        const output = await this.run(tool, args, { timeout: 3000 });
        return output.includes('org.freedesktop.portal.GlobalShortcuts') ? 'available' : 'unavailable';
      } catch { /* Portal may be absent or the bus may be unavailable. */ }
    }
    return 'unknown';
  }

  async start(): Promise<void> {
    await this.recheck();
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
    // Write-then-rename keeps re-applying the configuration atomic.
    const temporary = `${generated}.tmp`;
    await writeFile(temporary, formatSwhkdConfig(hotkey, executablePath), 'utf8');
    await rename(temporary, generated);
    this.hotkeyConfigPath = generated;
    if (!this.tools.swhkd) {
      this.hotkeyConnected = false;
      return false;
    }
    this.hotkeyConnected = await this.swhkdConnected(generated, true);
    return this.hotkeyConnected;
  }

  private async swhkdConnected(generated: string, reload: boolean): Promise<boolean> {
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
        if (!reload) return true;
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
        const backend = this.pasteBackend();
        if (backend === 'wtype') {
          try {
            return await this.run(this.tools.wtype!, ['-'], { input: text, timeout: 30_000 });
          } catch (error) {
            // wtype may already have typed part of the text. Falling back to a
            // clipboard backend here would insert it a second time.
            this.markBackendFailed('wtype', error);
            throw this.pasteFailure(error);
          }
        }
        if (backend === 'ydotool' || backend === 'dotool') {
          // Direct typing through these tools goes through the Wayland
          // clipboard. Restore it only if the user has not replaced it.
          const previous = await this.clipboardRead(() => Promise.resolve('')).catch(() => '');
          try {
            await this.clipboardWrite(text, () => Promise.resolve());
            await new Promise(resolve => setTimeout(resolve, 45));
            return await this.command('key', 'ctrl-v');
          } finally {
            await this.restoreClipboard(text, previous).catch(() => {});
          }
        }
        throw new Error('Автоматическая вставка недоступна. Текст сохранён в истории.');
      }

      // command === 'key' on Wayland
      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        const backend = this.pasteBackend();
        if (!backend) break;
        try {
          return await this.runKey(backend, argument);
        } catch (error) {
          this.markBackendFailed(backend, error);
          lastError = error;
          // Only try another tool when the backend never started. A non-zero
          // exit may already have delivered a partial key chord.
          if (!neverRan(error)) break;
        }
      }
      if (lastError) throw this.pasteFailure(lastError);
      throw new Error('Автоматическая вставка недоступна. Текст сохранён в истории.');
    }

    throw new Error('Автоматическая вставка недоступна. Текст сохранён в истории.');
  }

  private async runKey(backend: PasteBackend, argument: string): Promise<string> {
    if (backend === 'wtype') {
      const wtypeArgs: Record<string, string[]> = {
        'ctrl-v': ['-M', 'ctrl', '-k', 'v', '-m', 'ctrl'],
        'ctrl-shift-v': ['-M', 'ctrl', '-M', 'shift', '-k', 'v', '-m', 'shift', '-m', 'ctrl'],
        'shift-insert': ['-M', 'shift', '-k', 'Insert', '-m', 'shift'],
        enter: ['-k', 'Return'],
        'ctrl-enter': ['-M', 'ctrl', '-k', 'Return', '-m', 'ctrl'],
      };
      return this.run(this.tools.wtype!, wtypeArgs[argument]!);
    }
    if (backend === 'ydotool') {
      const ydotoolArgs: Record<string, string[]> = {
        'ctrl-v': ['key', '29:1', '47:1', '47:0', '29:0'],
        'ctrl-shift-v': ['key', '29:1', '42:1', '47:1', '47:0', '42:0', '29:0'],
        'shift-insert': ['key', '42:1', '110:1', '110:0', '42:0'],
        enter: ['key', '28:1', '28:0'],
        'ctrl-enter': ['key', '29:1', '28:1', '28:0', '29:0'],
      };
      return this.run(this.tools.ydotool!, ydotoolArgs[argument]!);
    }
    const dotoolInput: Record<string, string> = {
      'ctrl-v': 'key ctrl+v\n',
      'ctrl-shift-v': 'key ctrl+shift+v\n',
      'shift-insert': 'key shift+insert\n',
      enter: 'key enter\n',
      'ctrl-enter': 'key ctrl+enter\n',
    };
    return this.run(this.tools.dotool!, [], { input: dotoolInput[argument]! });
  }

  /** Restore the previous clipboard only while it still contains our text. */
  async restoreClipboard(dictated: string, previous: string,
    read?: () => Promise<string>, write?: (text: string) => Promise<void>): Promise<boolean> {
    // X11 has no wl-paste equivalent inside LinuxNative. Callers pass the host
    // clipboard bridge for both operations; Wayland falls back to its own
    // wl-clipboard tools when no bridge is supplied.
    const current = read
      ? await read().catch(() => undefined)
      : await this.clipboardRead(() => Promise.resolve('')).catch(() => undefined);
    if (current === undefined || current !== dictated) return false;
    if (write) await write(previous);
    else await this.clipboardWrite(previous, () => Promise.resolve());
    return true;
  }

  private markBackendFailed(backend: PasteBackend, error: unknown): void {
    this.broken.add(backend);
    this.lastPasteError = error instanceof Error ? error.message : String(error);
  }

  private pasteFailure(error: unknown): Error {
    const detail = error instanceof Error ? error.message : String(error);
    return new Error(`Не удалось вставить текст: ${detail}. Текст сохранён в истории.`);
  }
}
