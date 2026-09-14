import { utilityProcess } from 'electron';
import { dirname, join } from 'node:path';
import type { SpeechEngine, TranscriptionRequest } from './types';

export type SherpaEngineId = 'gigaam-v3-e2e-rnnt' | 'parakeet-tdt-0-6b-v3-int8' | 'moonshine-tiny-en-int8';

export class SherpaEngine implements SpeechEngine {
  constructor(readonly id: SherpaEngineId, private readonly languages: readonly string[]) {}

  async transcribe(request: TranscriptionRequest): Promise<string> {
    request.signal.throwIfAborted();
    if (request.language !== 'auto' && !this.languages.includes(request.language)) {
      throw new Error('Выбранный язык не поддерживается этой моделью. Выберите автоматическое определение или другой язык.');
    }
    return new Promise((resolve, reject) => {
      const child = utilityProcess.fork(join(__dirname, 'sherpa-worker.cjs'),
        [this.id, dirname(request.modelPath), request.wavPath], { stdio: 'pipe', serviceName: `Vokeyra ${this.id}` });
      let result: string | undefined;
      let failure: Error | undefined;
      let diagnostics = '';
      child.stderr?.on('data', (chunk: Buffer) => { diagnostics = (diagnostics + chunk.toString()).slice(-3000); });
      const abort = () => { failure = new Error('Распознавание отменено.'); child.kill(); };
      const timer = setTimeout(() => { failure = new Error('Превышен лимит распознавания модели.'); child.kill(); }, 15 * 60_000);
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
        else reject(new Error(`Не удалось запустить движок модели. ${diagnostics}`));
      });
      request.signal.addEventListener('abort', abort, { once: true });
      if (request.signal.aborted) abort();
    });
  }
}
