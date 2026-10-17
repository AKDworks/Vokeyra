import { describe, expect, it } from 'vitest';
import { mergeUpdateManifests } from '../scripts/update-manifest.mjs';

describe('multi-platform update manifest', () => {
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
