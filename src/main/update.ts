import type { AppUpdateState } from '../shared/contracts';

export interface UpdaterClient {
  autoDownload: boolean; autoInstallOnAppQuit: boolean; allowPrerelease: boolean;
  fullChangelog: boolean; disableWebInstaller: boolean;
  on(event: string, callback: (value: any) => void): unknown;
  checkForUpdates(): Promise<unknown>;
}

function updateError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/ENOSPC|no space left/i.test(message)) return 'Недостаточно свободного места для обновления.';
  if (/EACCES|EPERM|permission denied/i.test(message)) return 'Нет доступа для установки обновления.';
  if (/net|fetch|ENOTFOUND|ECONN|ETIMEDOUT|404|latest\.yml/i.test(message)) {
    return 'Не удалось скачать обновление. Проверьте интернет и повторите попытку.';
  }
  return 'Не удалось установить обновление. Повторите попытку позже.';
}

export class ApplicationUpdater {
  state: AppUpdateState;
  private installing = false;

  constructor(private client: UpdaterClient, currentVersion: string, private packaged: boolean,
    private emit: (state: AppUpdateState) => void, private install: () => Promise<void>) {
    this.state = { phase: 'idle', currentVersion };
    client.autoDownload = true;
    client.autoInstallOnAppQuit = false;
    client.allowPrerelease = false;
    client.fullChangelog = false;
    client.disableWebInstaller = true;

    client.on('checking-for-update', () => this.publish({ phase: 'checking', currentVersion }));
    client.on('update-available', info => this.publish({
      phase: 'available', currentVersion, latestVersion: info.version,
    }));
    client.on('update-not-available', info => this.publish({
      phase: 'current', currentVersion, latestVersion: info.version,
    }));
    client.on('download-progress', progress => this.publish({
      phase: 'downloading', currentVersion, latestVersion: this.state.latestVersion,
      percent: Math.max(0, Math.min(100, Math.round(progress.percent))),
    }));
    client.on('update-downloaded', info => {
      if (this.installing) return;
      this.installing = true;
      this.publish({ phase: 'installing', currentVersion, latestVersion: info.version });
      void this.install().catch(error => {
        this.installing = false;
        this.publish({ phase: 'error', currentVersion, latestVersion: info.version, message: updateError(error) });
      });
    });
    client.on('error', error => {
      this.installing = false;
      this.publish({ phase: 'error', currentVersion, latestVersion: this.state.latestVersion, message: updateError(error) });
    });
  }

  get busy(): boolean {
    return ['checking', 'available', 'downloading', 'installing'].includes(this.state.phase);
  }

  async check(): Promise<AppUpdateState> {
    if (this.busy) return this.state;
    if (!this.packaged) {
      const message = 'Автоматическое обновление доступно только в установленной версии Vokeyra.';
      this.publish({ phase: 'error', currentVersion: this.state.currentVersion, message });
      throw new Error(message);
    }
    this.publish({ phase: 'checking', currentVersion: this.state.currentVersion });
    try {
      const result = await this.client.checkForUpdates();
      if (!result) throw new Error('Служба обновлений недоступна.');
      return this.state;
    } catch (error) {
      if (this.state.phase !== 'error') {
        this.publish({ phase: 'error', currentVersion: this.state.currentVersion, message: updateError(error) });
      }
      throw new Error(this.state.message ?? updateError(error));
    }
  }

  private publish(state: AppUpdateState): void {
    this.state = state;
    this.emit({ ...state });
  }
}
