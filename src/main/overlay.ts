import { BrowserWindow, ipcMain, screen } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RecordingIndicator } from '../shared/contracts';

export class RecordingOverlay {
  private window: BrowserWindow;
  private state: RecordingIndicator = { phase: 'starting', level: 0, seconds: 0 };
  private position: 'bottom' | 'top' = 'bottom';
  private mode: 'none' | 'minimal' | 'realtime' = 'realtime';
  constructor(private url: string, cancel: () => void) {
    this.window = new BrowserWindow({ width: 248, height: 58, frame: false, transparent: true, show: false,
      resizable: false, maximizable: false, fullscreenable: false, focusable: false, skipTaskbar: true,
      alwaysOnTop: true, hasShadow: false, title: 'Vokeyra — запись',
      webPreferences: { preload: join(__dirname, '../preload/overlay.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    this.window.setAlwaysOnTop(true, 'pop-up-menu');
    this.window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.window.webContents.on('will-navigate', event => event.preventDefault());
    const trusted = (event: Electron.IpcMainInvokeEvent) => {
      if (event.sender !== this.window.webContents || event.senderFrame !== this.window.webContents.mainFrame || event.senderFrame.url !== this.url) throw new Error('Недоверенный источник индикатора.');
    };
    ipcMain.handle('overlay:state', event => { trusted(event); return this.state; });
    ipcMain.handle('overlay:cancel', event => { trusted(event); cancel(); });
  }
  async load(): Promise<void> { await this.window.loadURL(this.url); }
  setPosition(position: 'bottom' | 'top'): void { this.position = position; }
  setLanguage(appLanguage: 'ru' | 'en'): void {
    this.state = { ...this.state, appLanguage };
    if (!this.window.isDestroyed()) this.window.webContents.send('overlay:state', this.state);
  }
  setMode(mode: 'none' | 'minimal' | 'realtime'): void {
    this.mode = mode;
    this.state = { ...this.state, overlayMode: mode === 'minimal' ? 'minimal' : 'realtime' };
    if (mode === 'none') this.hide();
    else if (!this.window.isDestroyed()) this.window.webContents.send('overlay:state', this.state);
  }
  show(): void {
    if (this.window.isDestroyed() || this.mode === 'none') return;
    const { x, y, width, height } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    this.window.setPosition(Math.round(x + (width - 248) / 2), this.position === 'top' ? y + 20 : y + height - 78);
    this.window.showInactive();
    // Keep topmost without Electron's below-taskbar repositioning on Windows.
    this.window.setAlwaysOnTop(true, 'pop-up-menu');
  }
  update(state: RecordingIndicator): void {
    this.state = { ...state, appLanguage: this.state.appLanguage, overlayMode: this.mode === 'minimal' ? 'minimal' : 'realtime' };
    if (!this.window.isDestroyed()) this.window.webContents.send('overlay:state', this.state);
  }
  hide(): void { if (!this.window.isDestroyed()) this.window.hide(); }
  destroy(): void { if (!this.window.isDestroyed()) this.window.destroy(); }
}
export function overlayUrl(devUrl?: string): string {
  return devUrl ? `${devUrl}/overlay.html` : pathToFileURL(join(__dirname, '../renderer/overlay.html')).href;
}
