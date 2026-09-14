import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { httpsUrl } from './catalog';
import type { DownloadState, ModelArtifact } from '../shared/contracts';

export interface VerifiedDownload extends ModelArtifact { id: string }

// Follow redirects explicitly so an HTTPS download can never downgrade to HTTP.
export async function secureFetch(url: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<Response> {
  let current = httpsUrl(url);
  for (let i = 0; i < 8; i++) {
    const response = await fetcher(current, { signal, redirect: 'manual', credentials: 'omit' });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('Пустое перенаправление загрузки.');
      current = httpsUrl(new URL(location, current).href);
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Ошибка загрузки: HTTP ${response.status}.`); }
    return response;
  }
  throw new Error('Слишком много перенаправлений.');
}
export async function downloadVerified(
  item: VerifiedDownload, path: string, signal: AbortSignal,
  progress: (state: DownloadState) => void, fetcher: typeof fetch = fetch,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  let received = 0;
  let lastUpdate = 0;
  const hash = createHash('sha256');
  const update = (phase: DownloadState['phase']) => progress({ id: item.id, phase, received, total: item.sizeBytes });
  try {
    const response = await secureFetch(item.url, signal, fetcher);
    if (!response.body) throw new Error('Сервер вернул пустой файл.');
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        if (received > item.sizeBytes) return callback(new Error('Размер файла превышает размер из каталога.'));
        hash.update(chunk);
        if (Date.now() - lastUpdate > 100) { update('downloading'); lastUpdate = Date.now(); }
        callback(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body as never), meter, createWriteStream(path, { flags: 'wx' }), { signal });
    signal.throwIfAborted();
    update('verifying');
    if (received !== item.sizeBytes) throw new Error('Файл загружен не полностью. Повторите загрузку.');
    if (hash.digest('hex') !== item.sha256) throw new Error('SHA-256 не совпал. Повторите загрузку.');
  } catch (error) {
    await rm(path, { force: true });
    throw error;
  }
}
