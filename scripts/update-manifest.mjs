import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function collectUpdatePlatforms(root, version, platform, arch) {
  const architecture = { x64: 'x86_64', arm64: 'aarch64' }[arch];
  if (!architecture) throw new Error(`Unsupported update architecture: ${arch}`);
  const platforms = {};
  const formats = platform === 'win32' ? [['nsis', '.exe']] : platform === 'linux' ? [['appimage', '.AppImage'], ['deb', '.deb']] : [];
  if (!formats.length) throw new Error(`Unsupported update platform: ${platform}`);
  for (const [format, suffix] of formats) {
    const folder = join(root, format);
    const names = await readdir(folder);
    const installers = names.filter(name => name.includes(version) && name.endsWith(suffix));
    if (installers.length !== 1) throw new Error(`Expected one ${format} installer for ${version}, got ${installers.length}.`);
    const installer = installers[0];
    const signature = (await readFile(join(folder, installer + '.sig'), 'utf8')).trim();
    if (!signature) throw new Error(`Missing updater signature: ${installer}`);
    const value = { signature, url: `https://github.com/AKDworks/Vokeyra/releases/download/v${version}/${encodeURIComponent(installer)}` };
    const os = platform === 'win32' ? 'windows' : 'linux';
    platforms[`${os}-${architecture}-${format}`] = value;
    // Keep the old target for clients using the original Tauri manifest schema.
    if (format === 'nsis' || format === 'appimage') platforms[`${os}-${architecture}`] = value;
  }
  return platforms;
}

export function mergeUpdateManifests(manifests) {
  if (!manifests.length) throw new Error('No update manifests supplied.');
  const merged = { ...manifests[0], platforms: {} };
  for (const manifest of manifests) {
    if (manifest.version !== merged.version) throw new Error('Cannot merge update manifests for different versions.');
    for (const [target, value] of Object.entries(manifest.platforms)) {
      if (merged.platforms[target] && JSON.stringify(merged.platforms[target]) !== JSON.stringify(value)) throw new Error(`Conflicting updater target: ${target}`);
      merged.platforms[target] = value;
    }
  }
  return merged;
}
