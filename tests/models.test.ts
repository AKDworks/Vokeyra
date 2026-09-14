import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { create as createTar } from 'tar';
import { ModelManager } from '../src/main/models';
import catalog from '../resources/models.json';
import { parseCatalog } from '../src/main/catalog';
const directories: string[] = [];
const originalBytes = Buffer.from('original model');
const updatedBytes = Buffer.from('updated model!');
const source = parseCatalog(catalog).models.find(model => model.id === 'whisper-tiny')!;
const metadata = (bytes: Buffer) => {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return { ...source, sizeBytes: bytes.length, entrypoint: 'model.bin',
    artifacts: [{ filename: 'model.bin', format: 'file' as const, sizeBytes: bytes.length, url: source.artifacts[0]!.url, sha256 }] };
};
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'vokeyra-models-')); directories.push(directory);
  const manager = new ModelManager(join(directory, 'models'), join(directory, 'models.json'), () => {});
  await manager.init(resolve('resources/models.json'));
  await manager.replaceCatalog({ schemaVersion: 2, models: [metadata(originalBytes)] });
  return manager;
}
async function install(manager: ModelManager, bytes: Buffer, id = 'whisper-tiny') {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(Uint8Array.from(bytes))));
  manager.start(id);
  await vi.waitFor(() => expect(manager.downloads.get(id)?.phase).toMatch(/complete|error/));
}
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});
describe('installation lifecycle', () => {
  it('retains the installed model if an update fails SHA-256', async () => {
    const manager = await setup(); await install(manager, originalBytes);
    await manager.replaceCatalog({ schemaVersion: 2, models: [metadata(updatedBytes)] });
    await install(manager, originalBytes);
    expect(manager.downloads.get('whisper-tiny')?.phase).toBe('error');
    expect(await readFile(manager.filePath(metadata(originalBytes)))).toEqual(originalBytes);
    expect(manager.views(() => true)[0]?.updateAvailable).toBe(true);
    expect(manager.installed.get('whisper-tiny')?.model.artifacts[0]?.sha256).toBe(metadata(originalBytes).artifacts[0]?.sha256);
  });
  it('commits a valid update, removes the old file and keeps the bundled catalog authoritative on restart', async () => {
    const manager = await setup(); await install(manager, originalBytes);
    await manager.replaceCatalog({ schemaVersion: 2, models: [metadata(updatedBytes)] });
    await install(manager, updatedBytes);
    expect(await readFile(manager.filePath(metadata(updatedBytes)))).toEqual(updatedBytes);
    const restored = new ModelManager(manager.root, manager.catalogPath, () => {});
    await restored.init(resolve('resources/models.json'));
    expect(restored.installed.get('whisper-tiny')?.model.artifacts[0]?.sha256).toBe(metadata(updatedBytes).artifacts[0]?.sha256);
    expect(restored.views(() => true).find(item => item.model.id === 'whisper-tiny')?.updateAvailable).toBe(true);
  });
  it('keeps installed models absent from the new catalog and allows deletion', async () => {
    const manager = await setup(); await install(manager, originalBytes);
    await manager.replaceCatalog({ schemaVersion: 2, models: [] });
    expect(manager.views(() => true)).toHaveLength(1);
    await manager.remove('whisper-tiny');
    expect(manager.views(() => true)).toHaveLength(0);
    await expect(stat(manager.filePath(metadata(originalBytes)))).rejects.toThrow();
  });
  it('does not replace the cached catalog when validation fails', async () => {
    const manager = await setup();
    const previous = await readFile(manager.catalogPath, 'utf8');
    await expect(manager.replaceCatalog({ schemaVersion: 999, models: [] })).rejects.toThrow();
    expect(await readFile(manager.catalogPath, 'utf8')).toBe(previous);
  });
  it('removes abandoned partial downloads at startup', async () => {
    const manager = await setup();
    const dir = join(manager.root, 'whisper-tiny'); await mkdir(dir);
    const part = join(dir, `${'a'.repeat(64)}.part`); await writeFile(part, 'incomplete');
    await manager.init(resolve('resources/models.json'));
    await expect(stat(part)).rejects.toThrow();
  });
  it('installs and validates a model made of several files', async () => {
    const manager = await setup();
    const first = Buffer.from('model'); const second = Buffer.from('vocabulary');
    const artifact = (filename: string, bytes: Buffer) => ({ filename, format: 'file' as const, sizeBytes: bytes.length,
      url: `https://example.org/${filename}`, sha256: createHash('sha256').update(bytes).digest('hex') });
    const model = { ...source, id: 'multi-file-model', entrypoint: 'runtime/model.onnx', sizeBytes: first.length + second.length,
      artifacts: [artifact('runtime/model.onnx', first), artifact('runtime/vocab.txt', second)] };
    await manager.replaceCatalog({ schemaVersion: 2, models: [model] });
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => new Response(
      Uint8Array.from(String(url).endsWith('model.onnx') ? first : second))));
    manager.start(model.id);
    await vi.waitFor(() => expect(manager.downloads.get(model.id)?.phase).toBe('complete'));
    expect(await readFile(manager.filePath(model))).toEqual(first);
    expect(await readFile(join(manager.root, model.id, 'runtime', 'vocab.txt'))).toEqual(second);
  });
  it('extracts a verified tar.gz package before committing the model', async () => {
    const manager = await setup();
    const fixture = join(resolve(manager.root, '..'), 'archive-source');
    await mkdir(join(fixture, 'bundle'), { recursive: true });
    await writeFile(join(fixture, 'bundle', 'model.onnx'), 'archive model');
    const archivePath = join(resolve(manager.root, '..'), 'model.tar.gz');
    await createTar({ cwd: fixture, file: archivePath, gzip: true }, ['bundle']);
    const archive = await readFile(archivePath);
    const model = { ...source, id: 'archive-model', entrypoint: 'bundle/model.onnx', sizeBytes: archive.length,
      artifacts: [{ filename: 'model.tar.gz', format: 'tar.gz' as const, sizeBytes: archive.length,
        url: 'https://example.org/model.tar.gz', sha256: createHash('sha256').update(archive).digest('hex') }] };
    await manager.replaceCatalog({ schemaVersion: 2, models: [model] });
    await install(manager, archive, model.id);
    expect(manager.downloads.get(model.id)?.phase).toBe('complete');
    expect(await readFile(manager.filePath(model), 'utf8')).toBe('archive model');
  });
});
