import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const fixture = vi.hoisted(() => ({
  config: { dataPath: '', resourcePath: '', version: '0.3.3' },
  ready: false,
  routes: new Map<string, (...args: any[]) => any>(),
  start: undefined as undefined | (() => Promise<void>),
  shutdown: undefined as undefined | (() => Promise<void>),
}));
vi.mock('../src/main/host', async () => ({
  config: fixture.config,
  host: vi.fn().mockResolvedValue(null),
  hostEvents: new (await import('node:events')).EventEmitter(),
  emit: vi.fn(),
  route: (name: string, handler: (...args: any[]) => any) => fixture.routes.set(name, handler),
  serve: (start: () => Promise<void>, shutdown: () => Promise<void>) => { fixture.start = start; fixture.shutdown = shutdown; },
}));
vi.mock('../src/main/platform/desktop', () => ({ desktop: {
  capabilities: () => ({ platform: 'linux', session: 'wayland', globalShortcut: true, pushToTalk: fixture.ready, muteAudio: fixture.ready }),
  initialize: async () => { fixture.ready = true; },
  registerShortcut: async () => false,
  unregisterShortcut: async () => {},
  close: async () => {},
} }));
import '../src/main/service';

beforeAll(async () => {
  fixture.config.dataPath = await mkdtemp(join(tmpdir(), 'vokeyra-service-settings-'));
  fixture.config.resourcePath = resolve('resources');
  await writeFile(join(fixture.config.dataPath, 'settings.json'), JSON.stringify({ appLanguage: 'en', pushToTalk: true, muteWhileRecording: true }));
  await fixture.start!();
});
afterAll(async () => {
  await fixture.shutdown?.();
  if (fixture.config.dataPath) await rm(fixture.config.dataPath, { recursive: true, force: true });
});

it('loads saved preferences after discovering the desktop capabilities', async () => {
  const snapshot = await fixture.routes.get('app:snapshot')!();
  expect(snapshot.settings).toMatchObject({ appLanguage: 'en', pushToTalk: true, muteWhileRecording: true });
  expect(snapshot.hotkeyRegistered).toBe(false);
});

it('saves other settings even when the Wayland shortcut is not configured', async () => {
  await fixture.routes.get('settings:save')!({ historyLimit: 7 });
  const snapshot = await fixture.routes.get('app:snapshot')!();
  expect(snapshot.settings.historyLimit).toBe(7);
  expect(snapshot.hotkeyRegistered).toBe(false);
  expect(JSON.parse(await readFile(join(fixture.config.dataPath, 'settings.json'), 'utf8')).historyLimit).toBe(7);
});

it('reports an unapplied shortcut change without replacing the saved shortcut', async () => {
  const previous = (await fixture.routes.get('app:snapshot')!()).settings.hotkey;
  await expect(fixture.routes.get('settings:save')!({ hotkey: 'F8' })).rejects.toThrow('swhkd');
  expect((await fixture.routes.get('app:snapshot')!()).settings.hotkey).toBe(previous);
});
