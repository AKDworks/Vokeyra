import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import catalog from '../resources/models.json';
import { downloadVerified, secureFetch } from '../src/main/download';
import { parseCatalog } from '../src/main/catalog';
import type { VerifiedDownload } from '../src/main/download';
const folders: string[] = [];
const bytes = Buffer.from('test model payload');
const source = parseCatalog(catalog).models[0]!;
const model: VerifiedDownload = { ...source.artifacts[0]!, id: source.id, sizeBytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex') };
async function target() { const dir = await mkdtemp(join(tmpdir(), 'vokeyra-test-')); folders.push(dir); return join(dir, 'model.part'); }
afterEach(async () => { await Promise.all(folders.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
describe('model download', () => {
  it('streams bytes, reports progress and verifies a correct SHA-256', async () => {
    const path = await target(); const progress = vi.fn();
    await downloadVerified(model, path, new AbortController().signal, progress, vi.fn().mockResolvedValue(new Response(bytes)));
    expect(await readFile(path)).toEqual(bytes);
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'verifying', received: bytes.length }));
  });
  it.each([
    { ...model, sha256: '0'.repeat(64) },
    { ...model, sizeBytes: bytes.length + 10 },
    { ...model, sizeBytes: 2 },
  ])('rejects mismatched hash or length and removes the partial file', async m => {
    const path = await target();
    await expect(downloadVerified(m, path, new AbortController().signal, () => {}, vi.fn().mockResolvedValue(new Response(bytes)))).rejects.toThrow();
    await expect(stat(path)).rejects.toThrow();
  });
  it('cancels an active stream and deletes partial data, then permits retry', async () => {
    const path = await target(); const controller = new AbortController();
    const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1, 2, 3])); } });
    await expect(downloadVerified(model, path, controller.signal, () => controller.abort(), vi.fn().mockResolvedValue(new Response(stream)))).rejects.toThrow();
    await expect(stat(path)).rejects.toThrow();
    await downloadVerified(model, path, new AbortController().signal, () => {}, vi.fn().mockResolvedValue(new Response(bytes)));
    expect(await readFile(path)).toEqual(bytes);
  });
  it('refuses HTTPS to HTTP redirects', async () => {
    await expect(secureFetch(model.url, new AbortController().signal, vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'http://example.org/model' } })))).rejects.toThrow('HTTPS');
  });
  it('follows legitimate CDN redirects without credentials', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://cdn.example.org/model' } })).mockResolvedValueOnce(new Response(bytes));
    expect((await secureFetch(model.url, new AbortController().signal, fetcher)).ok).toBe(true);
    expect(fetcher).toHaveBeenLastCalledWith('https://cdn.example.org/model', expect.objectContaining({ credentials: 'omit', redirect: 'manual' }));
  });
});
