import { fork } from 'node:child_process';
import { join } from 'node:path';
import type { SpeechEngine, TranscriptionRequest } from './types';
import { ModelWorker, type WorkerProcess } from './worker-client';

export class GigaAmEngine implements SpeechEngine {
  private worker?: ModelWorker;
  private modelPath = '';
  private idleTimeoutMs: number | null = 5 * 60_000;

  constructor(readonly id = 'gigaam-v3-e2e-ctc', private readonly languages: readonly string[] = ['ru']) {}

  setIdleTimeout(timeoutMs: number | null): void {
    this.idleTimeoutMs = timeoutMs;
    this.worker?.setIdleTimeout(timeoutMs);
  }

  unload(): void {
    this.worker?.unload();
    this.worker = undefined;
    this.modelPath = '';
  }

  async transcribe(request: TranscriptionRequest): Promise<string> {
    request.signal.throwIfAborted();
    if (request.language !== 'auto' && !this.languages.includes(request.language)) {
      throw new Error('Выбранный язык не поддерживается этой моделью.');
    }
    if (!this.worker || this.modelPath !== request.modelPath) {
      this.unload();
      this.modelPath = request.modelPath;
      this.worker = new ModelWorker(() => { const child = fork(
        join(__dirname, 'gigaam-worker.cjs'), [this.id, request.modelPath],
        { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], ...{ windowsHide: true } }); return Object.assign(child, { postMessage: (message: unknown) => child.send(message as object) }) as unknown as WorkerProcess; }, 'GigaAM');
      this.worker.setIdleTimeout(this.idleTimeoutMs);
    }
    return this.worker.run(request.wavPath, request.signal);
  }
}
