import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const fixture = vi.hoisted(() => ({
  config: { dataPath: '', resourcePath: '', version: '0.3.3' },
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
  capabilities: () => ({ platform: 'linux', session: 'wayland', globalShortcut: true, pushToTalk: false, muteAudio: false }),
  initialize: async () => {},
  registerShortcut: async () => false,
  unregisterShortcut: async () => {},
  close: async () => {},
} }));
import '../src/main/service';

beforeAll(async () => {
  fixture.config.dataPath = await mkdtemp(join(tmpdir(), 'vokeyra-service-migration-'));
  fixture.config.resourcePath = resolve('resources');
  await writeFile(join(fixture.config.dataPath, 'settings.json'), JSON.stringify({
    appLanguage: 'en', pushToTalk: true, muteWhileRecording: true, historyLimit: 9,
  }));
  await fixture.start!();
});
afterAll(async () => {
  await fixture.shutdown?.();
  if (fixture.config.dataPath) await rm(fixture.config.dataPath, { recursive: true, force: true });
});

it('keeps portable settings when a profile moves to an environment without push-to-talk or audio mute', async () => {
  const snapshot = await fixture.routes.get('app:snapshot')!();
  expect(snapshot.settings).toMatchObject({
    appLanguage: 'en', historyLimit: 9, pushToTalk: false, muteWhileRecording: false,
  });
});
