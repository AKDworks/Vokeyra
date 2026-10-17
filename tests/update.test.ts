import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { ApplicationUpdater, type UpdaterClient } from '../src/main/update';
import type { AppUpdateState } from '../src/shared/contracts';

class FakeUpdater extends EventEmitter {
  autoDownload = false;
  autoInstallOnAppQuit = true;
  allowPrerelease = true;
  fullChangelog = true;
  disableWebInstaller = false;
  checkForUpdates = vi.fn(async () => ({}) as never);
}

describe('automatic application updates', () => {
  it('checks without downloading prereleases or web installers', async () => {
    const client = new FakeUpdater();
    const states: AppUpdateState[] = [];
    const updates = new ApplicationUpdater(client as unknown as UpdaterClient, '0.2.0', true, state => states.push(state), vi.fn());

    const pending = updates.check();
    client.emit('update-not-available', { version: '0.2.0' });
    await pending;

    expect(client.autoDownload).toBe(true);
    expect(client.autoInstallOnAppQuit).toBe(false);
    expect(client.allowPrerelease).toBe(false);
    expect(client.disableWebInstaller).toBe(true);
    expect(states.at(-1)).toMatchObject({ phase: 'current', latestVersion: '0.2.0' });
    expect(updates.busy).toBe(false);
  });

  it('reports download progress and starts installation', async () => {
    const client = new FakeUpdater();
    const install = vi.fn(async () => {});
    const states: AppUpdateState[] = [];
    const updates = new ApplicationUpdater(client as unknown as UpdaterClient, '0.2.0', true, state => states.push(state), install);

    await updates.check();
    client.emit('update-available', { version: '0.2.1' });
    client.emit('download-progress', { percent: 42.4 });
    client.emit('update-downloaded', { version: '0.2.1' });
    await vi.waitFor(() => expect(install).toHaveBeenCalledOnce());

    expect(states).toContainEqual({ phase: 'downloading', currentVersion: '0.2.0', latestVersion: '0.2.1', percent: 42 });
    expect(states.at(-1)).toMatchObject({ phase: 'installing', latestVersion: '0.2.1' });
  });

  it('allows retrying after an update error', async () => {
    const client = new FakeUpdater();
    client.checkForUpdates.mockRejectedValueOnce(new Error('fetch failed'));
    const states: AppUpdateState[] = [];
    const updates = new ApplicationUpdater(client as unknown as UpdaterClient, '0.2.0', true, state => states.push(state), vi.fn());

    await expect(updates.check()).rejects.toThrow('Не удалось скачать обновление');
    expect(states.at(-1)).toMatchObject({ phase: 'error' });
    expect(updates.busy).toBe(false);
    await updates.check();
    expect(client.checkForUpdates).toHaveBeenCalledTimes(2);
  });
});
