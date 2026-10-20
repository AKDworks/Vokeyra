import { config, host } from '../host';
import { WindowsNative } from './windows-native';
import { LinuxNative } from './linux-native';
import { windowsShortcutKeys } from './windows-keys';
import type { DesktopCapabilities, Preferences } from '../../shared/contracts';

// OS integration lives here; future native paste implementations can be added per OS.
export interface DesktopIntegration {
  capabilities(): DesktopCapabilities;
  registerShortcut(accelerator: string, callback: () => void): Promise<boolean>;
  unregisterShortcut(accelerator: string): Promise<void>;
  copyText(text: string): Promise<void>;
  deliverText(text: string, settings: Preferences): Promise<void>;
  initialize(onRelease: () => void, onFailure: (error: Error) => void): Promise<void>;
  watchRelease(key: string): Promise<void>;
  muteAudio(): Promise<void>;
  restoreAudio(): Promise<void>;
  close(): Promise<void>;
}
const native = process.platform === 'win32' ? new WindowsNative() : undefined;
const linux = process.platform === 'linux' ? new LinuxNative() : undefined;
const input = native ?? linux;
let closing = false;
const clipboardRead = () => linux ? linux.clipboardRead(() => host<string>('clipboard:read')) : host<string>('clipboard:read');
const clipboardWrite = (text: string) => linux ? linux.clipboardWrite(text, value => host('clipboard:write', value)) : host('clipboard:write', text);
export const desktop: DesktopIntegration = {
  capabilities: () => linux?.capabilities() ?? { platform: native ? 'windows' : 'other', session: 'native',
    globalShortcut: !!native, pushToTalk: !!native, muteAudio: !!native, automaticPaste: !!native, directTyping: !!native },
  registerShortcut: (key, callback) => {
    if (linux) {
      if (linux.capabilities().session === 'wayland') return linux.syncHotkey(key, config.dataPath, config.executablePath);
      if (!linux.capabilities().globalShortcut) return Promise.resolve(false);
    }
    return host<boolean>('shortcut:register', key);
  },
  unregisterShortcut: key => host('shortcut:unregister', key),
  copyText: clipboardWrite,
  deliverText: async (text, settings) => {
    if (!input || (linux && !linux.capabilities().automaticPaste)) { await clipboardWrite(text); return; }
    // Direct typing and copy-only mode do not need to read the old clipboard.
    const previous = settings.pasteMethod !== 'direct' && settings.pasteMethod !== 'none' && settings.clipboardHandling === 'restore'
      ? await clipboardRead() : '';
    if (settings.pasteMethod === 'direct') await input.command('type', Buffer.from(text, 'utf8').toString('base64'));
    else {
      await clipboardWrite(text);
      if (settings.pasteMethod !== 'none') {
        await new Promise(resolve => setTimeout(resolve, 45));
        await input.command('key', settings.pasteMethod);
        if (settings.clipboardHandling === 'restore') {
          await new Promise(resolve => setTimeout(resolve, 160));
          await clipboardWrite(previous);
        }
      }
    }
    if (settings.pasteMethod !== 'none' && settings.autoSubmit !== 'off') {
      await new Promise(resolve => setTimeout(resolve, 60));
      await input.command('key', settings.autoSubmit);
    }
  },
  initialize: async (onRelease, onFailure) => {
    if (native) { native.onRelease = onRelease; native.onFailure = onFailure; await native.start(); }
    await linux?.start();
  },
  watchRelease: async key => { if (native) await native.command('watch', windowsShortcutKeys(key)); },
  muteAudio: async () => {
    if (native) { await native.command('mute'); return; }
    if (linux && linux.capabilities().muteAudio) { await linux.command('mute'); return; }
    throw new Error('Отключение системного звука недоступно в вашей системе.');
  },
  restoreAudio: async () => {
    if (closing) return;
    if (native) await native.command('restore');
    else if (linux && linux.capabilities().muteAudio) await linux.command('restore').catch(() => {});
  },
  close: async () => { closing = true; await native?.close(); },
};
