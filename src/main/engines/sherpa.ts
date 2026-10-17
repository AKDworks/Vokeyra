import { fork } from 'node:child_process';
import { dirname, join } from 'node:path';
import type { SpeechEngine, TranscriptionRequest } from './types';
import { ModelWorker, type WorkerProcess } from './worker-client';
import { sherpaModels, type SherpaEngineId } from '../../shared/sherpa-models';

export class SherpaEngine implements SpeechEngine {
  private worker?: ModelWorker;
  private modelDirectory = '';
  private workerLanguage = '';
  private idleTimeoutMs: number | null = 5 * 60_000;

  constructor(readonly id: SherpaEngineId, private readonly languages: readonly string[] = sherpaModels[id]) {}

  setIdleTimeout(timeoutMs: number | null): void {
    this.idleTimeoutMs = timeoutMs;
    this.worker?.setIdleTimeout(timeoutMs);
  }

  unload(): void {
    this.worker?.unload();
    this.worker = undefined;
    this.modelDirectory = '';
    this.workerLanguage = '';
  }

  async transcribe(request: TranscriptionRequest): Promise<string> {
    request.signal.throwIfAborted();
    if (request.language !== 'auto' && !this.languages.includes(request.language)) {
      throw new Error('Выбранный язык не поддерживается этой моделью. Выберите автоматическое определение или другой язык.');
    }
    const directory = dirname(request.modelPath);
    const language = this.id === 'sensevoice-small-int8' ? request.language : 'auto';
    if (!this.worker || this.modelDirectory !== directory || this.workerLanguage !== language) {
      this.unload();
      this.modelDirectory = directory;
      this.workerLanguage = language;
      this.worker = new ModelWorker(() => { const child = fork(
        join(__dirname, 'sherpa-worker.cjs'), [this.id, directory, language],
        { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], ...{ windowsHide: true } }); return Object.assign(child, { postMessage: (message: unknown) => child.send(message as object) }) as unknown as WorkerProcess; }, 'Движок модели');
      this.worker.setIdleTimeout(this.idleTimeoutMs);
    }
    return this.worker.run(request.wavPath, request.signal);
  }
}
