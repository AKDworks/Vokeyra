import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectUpdatePlatforms, mergeUpdateManifests } from '../scripts/update-manifest.mjs';

async function installers(formats, check) {
  const root = await mkdtemp(join(tmpdir(), 'vokeyra-update-manifest-'));
  try {
    for (const [format, name] of formats) {
      await mkdir(join(root, format));
      await writeFile(join(root, format, name), 'installer');
      await writeFile(join(root, format, name + '.sig'), format + '-signature');
    }
    await check(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}

describe('multi-platform update manifest', () => {
  it('keeps MSI and EXE updates separate and retains the legacy EXE target', async () => {
    await installers([['nsis', 'Vokeyra_0.3.0_x64-setup.exe'], ['msi', 'Vokeyra_0.3.0_x64_en-US.msi']], async root => {
      const platforms = await collectUpdatePlatforms(root, '0.3.0', 'win32', 'x64');
      expect(platforms['windows-x86_64-msi'].url).toContain('Vokeyra_0.3.0_x64_en-US.msi');
      expect(platforms['windows-x86_64-msi'].signature).toBe('msi-signature');
      expect(platforms['windows-x86_64-nsis'].signature).toBe('nsis-signature');
      expect(platforms['windows-x86_64']).toEqual(platforms['windows-x86_64-nsis']);
    });
  });
  it('can generate an MSI-only manifest without an EXE build', async () => {
    await installers([['msi', 'Vokeyra_0.3.0_x64_en-US.msi']], async root => {
      const platforms = await collectUpdatePlatforms(root, '0.3.0', 'win32', 'x64', ['msi']);
      expect(Object.keys(platforms)).toEqual(['windows-x86_64-msi']);
    });
  });
  it('uses an RPM-specific updater target without the AppImage fallback', async () => {
    await installers([['rpm', 'Vokeyra-0.3.0-1.x86_64.rpm']], async root => {
      const platforms = await collectUpdatePlatforms(root, '0.3.0', 'linux', 'x64', ['rpm']);
      expect(Object.keys(platforms)).toEqual(['linux-x86_64-rpm']);
      expect(platforms['linux-x86_64-rpm'].signature).toBe('rpm-signature');
      expect(platforms['linux-x86_64-rpm'].url).toContain('/v0.3.0/Vokeyra-0.3.0-1.x86_64.rpm');
    });
  });
  it('keeps Windows, AppImage, and Debian targets together', () => {
    const win = { version: '0.3.0', platforms: { 'windows-x86_64': { url: 'https://example.org/win.exe', signature: 'win' } } };
    const linux = { version: '0.3.0', platforms: {
      'linux-x86_64-appimage': { url: 'https://example.org/linux.AppImage', signature: 'appimage' },
      'linux-x86_64-deb': { url: 'https://example.org/linux.deb', signature: 'deb' },
    } };
    expect(mergeUpdateManifests([win, linux]).platforms).toEqual({ ...win.platforms, ...linux.platforms });
    expect(Object.keys(win.platforms)).toHaveLength(1);
  });
  it('rejects mismatched versions and conflicting targets', () => {
    expect(() => mergeUpdateManifests([{ version: '0.2.0', platforms: {} }, { version: '0.3.0', platforms: {} }])).toThrow('different versions');
    expect(() => mergeUpdateManifests([{ version: '0.3.0', platforms: { linux: { signature: 'a' } } }, { version: '0.3.0', platforms: { linux: { signature: 'b' } } }])).toThrow('Conflicting');
  });
});
