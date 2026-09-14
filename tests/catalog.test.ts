import { describe, expect, it } from 'vitest';
import catalog from '../resources/models.json';
import { parseCatalog, httpsUrl } from '../src/main/catalog';
describe('catalog trust boundary', () => {
  it('loads the bundled catalog with actual sizes and SHA-256 digests', () => {
    expect(parseCatalog(catalog).models.length).toBeGreaterThanOrEqual(4);
  });
  it('publishes the real language coverage for every bundled model family', () => {
    const models = new Map(parseCatalog(catalog).models.map(model => [model.id, model]));
    for (const id of [
      'whisper-tiny-q5-1', 'whisper-tiny',
      'whisper-base-q5-1', 'whisper-base',
      'whisper-small-q5-1', 'whisper-small',
      'whisper-medium-q5-0',
    ]) expect(new Set(models.get(id)?.languages).size).toBe(99);

    for (const id of ['whisper-large-v3-turbo-q5-0', 'whisper-large-v3-q5-0']) {
      expect(new Set(models.get(id)?.languages).size).toBe(100);
      expect(models.get(id)?.languages).toContain('yue');
    }
    expect(models.get('gigaam-v3-e2e-ctc')?.languages).toEqual(['ru']);
    expect(models.get('gigaam-v3-e2e-rnnt')?.languages).toEqual(['ru']);
    expect(new Set(models.get('parakeet-tdt-0-6b-v3-int8')?.languages).size).toBe(25);
    expect(models.get('moonshine-tiny-en-int8')?.languages).toEqual(['en']);
    expect(models.get('gigaam-multilingual-ctc')?.languages).toEqual(['ru', 'kk', 'ky', 'uz', 'en']);
    expect([...models.values()].filter(model => model.recommended)).toHaveLength(5);
  });
  it('rejects more than five editorial recommendations', () => {
    expect(() => parseCatalog({ ...catalog, models: catalog.models.slice(0, 6).map(model => ({ ...model, recommended: true })) })).toThrow('не больше пяти');
  });
  it.each(['../escape', 'a/b', 'C:\\file', '..', 'UPPERCASE', ''])('rejects unsafe model ID %s', id => {
    expect(() => parseCatalog({ ...catalog, models: [{ ...catalog.models[0], id }] })).toThrow();
  });
  it('rejects duplicate IDs', () => {
    expect(() => parseCatalog({ ...catalog, models: [catalog.models[0], catalog.models[0]] })).toThrow();
  });
  it.each([{ sha256: 'not-a-hash' }, { sizeBytes: -1 }, { sizeBytes: 1.5 }, { url: 'http://example.org/a' }, { languages: [] }])('rejects invalid legacy metadata %j', patch => {
    const current = catalog.models[0]!;
    const artifact = current.artifacts[0]!;
    const { artifacts: _artifacts, entrypoint: _entrypoint, family: _family, quantization: _quantization,
      capabilities: _capabilities, ...legacy } = current;
    expect(() => parseCatalog({ schemaVersion: 1, models: [{ ...legacy, url: artifact.url, sha256: artifact.sha256,
      sizeBytes: artifact.sizeBytes, ...patch }] })).toThrow();
  });
  it('normalizes a legacy single-file catalog into the package format', () => {
    const legacy = { ...catalog, schemaVersion: 1, models: [{ ...catalog.models[0], artifacts: undefined, entrypoint: undefined }] };
    const raw = legacy.models[0] as unknown as Record<string, unknown>;
    const artifact = (catalog.models[0] as unknown as Record<string, unknown>).artifacts as Array<Record<string, unknown>>;
    raw.url = artifact[0]!.url; raw.sha256 = artifact[0]!.sha256; raw.sizeBytes = artifact[0]!.sizeBytes;
    const parsed = parseCatalog(legacy).models[0]!;
    expect(parsed.artifacts).toHaveLength(1);
    expect(parsed.entrypoint).toBe(`${artifact[0]!.sha256}.bin`);
  });
  it('rejects unsafe package paths', () => {
    const model = catalog.models[0]!;
    for (const entrypoint of ['../model.bin', 'C:\\model.bin', 'CON/model.bin', '.internal/model.bin']) {
      expect(() => parseCatalog({ ...catalog, models: [{ ...model, entrypoint }] })).toThrow();
    }
  });
  it('keeps future engines as metadata without enabling execution', () => {
    expect(parseCatalog({ ...catalog, models: [{ ...catalog.models[0], engine: 'gigaam' }] }).models[0]?.engine).toBe('gigaam');
  });
  it('rejects embedded credentials and non-HTTPS URLs', () => {
    for (const url of ['file:///etc/passwd', 'https://user:secret@example.org', 'javascript:alert(1)']) expect(() => httpsUrl(url)).toThrow();
  });
});
