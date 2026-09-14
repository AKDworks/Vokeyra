import { utilityProcess } from 'electron';
import { join } from 'node:path';
import type { SpeechEngine, TranscriptionRequest } from './types';

export class GigaAmEngine implements SpeechEngine {
  constructor(readonly id = 'gigaam-v3-e2e-ctc', private readonly languages: readonly string[] = ['ru']) {}
  async transcribe(request: TranscriptionRequest): Promise<string> {
    request.signal.throwIfAborted();
    if (request.language !== 'auto' && !this.languages.includes(request.language)) throw new Error('Выбранный язык не поддерживается этой моделью.');
    return new Promise((resolve, reject) => {
      const child = utilityProcess.fork(join(__dirname, 'gigaam-worker.cjs'), [this.id, request.modelPath, request.wavPath],
        { stdio: 'pipe', serviceName: 'Vokeyra GigaAM' });
      let result: string | undefined;
      let failure: Error | undefined;
      let diagnostics = '';
      child.stderr?.on('data', (chunk: Buffer) => { diagnostics = (diagnostics + chunk.toString()).slice(-2000); });
      const abort = () => { failure = new Error('Распознавание отменено.'); child.kill(); };
      const timer = setTimeout(() => { failure = new Error('Превышен лимит распознавания GigaAM.'); child.kill(); }, 15 * 60_000);
      child.on('message', (message: unknown) => {
        if (!message || typeof message !== 'object') return;
        const data = message as { text?: unknown; error?: unknown };
        if (typeof data.text === 'string') result = data.text.slice(0, 100_000);
        if (typeof data.error === 'string') failure = new Error(data.error);
        child.kill();
      });
      child.once('exit', () => {
        clearTimeout(timer); request.signal.removeEventListener('abort', abort);
        if (failure) reject(failure);
        else if (result !== undefined) resolve(result);
        else reject(new Error(`Не удалось запустить GigaAM. ${diagnostics}`));
      });
      request.signal.addEventListener('abort', abort, { once: true });
      if (request.signal.aborted) abort();
    });
  }
}
