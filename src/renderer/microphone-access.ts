import type { DesktopApi } from '../shared/contracts';
import { onAppLanguageChange, tr } from './i18n';
import { microphoneAccessDenied } from './microphone-errors';

export class MicrophoneAccess {
  private button = document.getElementById('allow-microphone') as HTMLButtonElement;
  private help = document.getElementById('microphone-access-help')!;
  private status = document.getElementById('microphone-access-status')!;
  private settings = document.getElementById('microphone-settings') as HTMLButtonElement;
  private busy = false;
  private requesting = false;
  private state: PermissionState = 'prompt';
  private windows = false;
  private statusMessage = '';

  constructor(private api: DesktopApi, private onGranted: () => Promise<void>, private onRequesting: (requesting: boolean) => void) {
    onAppLanguageChange(() => this.render());
    this.button.onclick = () => { void this.request(); };
    this.settings.onclick = () => {
      void this.api.openMicrophoneSettings().catch(() => this.message('Не удалось открыть настройки микрофона.'));
    };
  }
  async initialize(windows: boolean): Promise<void> {
    this.windows = windows;
    try {
      const permission = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      const update = () => {
        this.state = permission.state;
        if (this.state === 'denied') this.blocked();
        else if (this.state === 'granted') { this.help.hidden = true; this.settings.hidden = true; }
        this.render();
      };
      permission.addEventListener('change', update);
      update();
    } catch { this.render(); }
  }
  setBusy(busy: boolean): void { this.busy = busy; this.render(); }
  blocked(): void {
    this.state = 'denied';
    this.message('Доступ к микрофону заблокирован. Нажмите «Разрешить», чтобы предоставить доступ приложению.');
    this.settings.hidden = !this.windows;
    this.render();
  }
  private message(value: string): void { this.statusMessage = value; this.status.textContent = tr(value); this.help.hidden = false; }
  private render(): void {
    this.status.textContent = tr(this.statusMessage);
    this.button.disabled = this.busy || this.requesting;
    this.settings.disabled = this.busy || this.requesting;
    this.button.textContent = tr(this.requesting ? 'Запрашиваем доступ…' : this.state === 'granted' ? 'Проверить доступ' : 'Разрешить');
  }
  private async request(): Promise<void> {
    if (this.busy || this.requesting) return;
    this.requesting = true; this.help.hidden = true; this.onRequesting(true); this.render();
    try {
      if (this.windows && this.state === 'denied') {
        await this.api.grantMicrophonePermission();
        this.state = 'granted';
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      stream.getTracks().forEach(track => track.stop());
      this.state = 'granted'; this.settings.hidden = true;
      this.message('Доступ к микрофону разрешён.');
      await this.onGranted();
    } catch (error) {
      if (microphoneAccessDenied(error)) {
        if (this.windows && this.state === 'granted') {
          this.message('Включите доступ к микрофону и разрешение для классических приложений в настройках Windows.');
          this.settings.hidden = false;
        } else this.blocked();
      }
      else {
        this.message(error instanceof Error ? error.message : 'Не удалось получить доступ к микрофону.');
        this.settings.hidden = !this.windows;
      }
    } finally { this.requesting = false; this.onRequesting(false); this.render(); }
  }
}
