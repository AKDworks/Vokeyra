import { clipboard, globalShortcut } from 'electron';
import { WindowsNative } from './windows-native';
import { windowsShortcutKeys } from './windows-keys';
import type { Preferences } from '../../shared/contracts';

// OS integration lives here; future native paste implementations can be added per OS.
export interface DesktopIntegration {
  registerShortcut(accelerator: string, callback: () => void): boolean;
  unregisterShortcut(accelerator: string): void;
  copyText(text: string): void;
  deliverText(text: string, settings: Preferences): Promise<void>;
  initialize(onRelease: () => void, onFailure: (error: Error) => void): Promise<void>;
  watchRelease(key: string): Promise<void>;
  muteAudio(): Promise<void>;
  restoreAudio(): Promise<void>;
  close(): Promise<void>;
}
const native = process.platform === 'win32' ? new WindowsNative() : undefined;
let closing = false;
export const desktop: DesktopIntegration = {
  registerShortcut: (key, callback) => globalShortcut.register(key, callback),
  unregisterShortcut: key => globalShortcut.unregister(key),
  copyText: text => clipboard.writeText(text),
  deliverText: async (text, settings) => {
    if (!native) { clipboard.writeText(text); return; }
    const previous = await clipboard.readText();
    if (settings.pasteMethod === 'direct') await native.command('type', Buffer.from(text, 'utf8').toString('base64'));
    else {
      clipboard.writeText(text);
      if (settings.pasteMethod !== 'none') {
        await new Promise(resolve => setTimeout(resolve, 45));
        await native.command('key', settings.pasteMethod);
        if (settings.clipboardHandling === 'restore') {
          await new Promise(resolve => setTimeout(resolve, 160));
          clipboard.writeText(previous);
        }
      }
    }
    if (settings.pasteMethod !== 'none' && settings.autoSubmit !== 'off') {
      await new Promise(resolve => setTimeout(resolve, 60));
      await native.command('key', settings.autoSubmit);
    }
  },
  initialize: async (onRelease, onFailure) => { if (native) { native.onRelease = onRelease; native.onFailure = onFailure; await native.start(); } },
  watchRelease: async key => { if (native) await native.command('watch', windowsShortcutKeys(key)); },
  muteAudio: async () => { if (!native) throw new Error('Отключение системного звука пока доступно только в Windows.'); await native.command('mute'); },
  restoreAudio: async () => { if (native && !closing) await native.command('restore'); },
  close: async () => { closing = true; await native?.close(); },
};
