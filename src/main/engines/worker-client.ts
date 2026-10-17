import type { EventEmitter } from 'node:events';
import type { Readable } from 'node:stream';

export interface WorkerProcess extends Pick<EventEmitter, 'on' | 'once'> { postMessage(message: unknown): void; kill(): boolean; stderr: Readable | null; pid?: number }

interface PendingRequest {
  id: number;
  signal: AbortSignal;
  resolve: (text: string) => void;
  reject: (error: Error) => void;
  abort: () => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class ModelWorker {
  private child?: WorkerProcess;
  private ready?: Promise<void>;
  private pending?: PendingRequest;
  private unloadTimer?: ReturnType<typeof setTimeout>;
  private idleTimeoutMs: number | null = 5 * 60_000;
  private requestId = 0;
  private diagnostics = '';

  constructor(private create: () => WorkerProcess, private label: string) {}

  setIdleTimeout(timeoutMs: number | null): void {
    this.idleTimeoutMs = timeoutMs;
    if (this.child && !this.pending) this.scheduleUnload();
  }

  run(wavPath: string, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    if (this.pending) throw new Error(`${this.label} уже обрабатывает запись.`);
    this.clearUnloadTimer();
    const child = this.ensureProcess();
    const id = ++this.requestId;
    return new Promise<string>((resolve, reject) => {
      const abort = () => this.finish(id, new Error('Распознавание отменено.'), true);
      const timeout = setTimeout(() => {
        this.finish(id, new Error(`Превышен лимит распознавания: 15 минут (${this.label}).`), true);
      }, 15 * 60_000);
      timeout.unref();
      this.pending = { id, signal, resolve, reject, abort, timeout };
      signal.addEventListener('abort', abort, { once: true });
      void this.ready!.then(() => {
        if (this.pending?.id === id && !signal.aborted) child.postMessage({ id, wavPath });
      }).catch(error => this.finish(id, error instanceof Error ? error : new Error(String(error)), true));
      if (signal.aborted) abort();
    });
  }

  unload(): void {
    if (this.pending) this.finish(this.pending.id, new Error('Распознавание отменено.'), true);
    else this.terminate();
  }

  private ensureProcess(): WorkerProcess {
    if (this.child) return this.child;
    const child = this.create();
    this.child = child;
    this.diagnostics = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      this.diagnostics = (this.diagnostics + chunk.toString()).slice(-3000);
    });
    this.ready = new Promise<void>((resolve, reject) => {
      let spawned = false;
      child.once('error', reject);
      child.once('spawn', () => { spawned = true; resolve(); });
      child.once('exit', code => {
        if (!spawned) reject(new Error(`Не удалось запустить ${this.label}. ${this.diagnostics}`.trim()));
        this.processExited(child, code);
      });
    });
    child.on('message', (message: unknown) => this.received(message));
    return child;
  }

  private received(message: unknown): void {
    if (!message || typeof message !== 'object') return;
    const data = message as { id?: unknown; text?: unknown; error?: unknown };
    if (typeof data.id !== 'number' || data.id !== this.pending?.id) return;
    if (typeof data.text === 'string') {
      this.finish(data.id, data.text.slice(0, 100_000), false);
    } else if (typeof data.error === 'string') {
      this.finish(data.id, new Error(data.error), true);
    }
  }

  private processExited(child: WorkerProcess, code: number): void {
    if (this.child !== child) return;
    this.child = undefined;
    this.ready = undefined;
    this.clearUnloadTimer();
    if (this.pending) {
      const suffix = this.diagnostics ? ` ${this.diagnostics}` : '';
      this.finish(this.pending.id, new Error(`${this.label} завершился с кодом ${code}.${suffix}`), false);
    }
  }

  private finish(id: number, result: string | Error, terminate: boolean): void {
    const pending = this.pending;
    if (!pending || pending.id !== id) return;
    this.pending = undefined;
    clearTimeout(pending.timeout);
    pending.signal.removeEventListener('abort', pending.abort);
    if (result instanceof Error) pending.reject(result); else pending.resolve(result);
    if (terminate) this.terminate(); else this.scheduleUnload();
  }

  private scheduleUnload(): void {
    this.clearUnloadTimer();
    if (!this.child || this.pending || this.idleTimeoutMs === null) return;
    if (this.idleTimeoutMs === 0) { this.terminate(); return; }
    this.unloadTimer = setTimeout(() => this.terminate(), this.idleTimeoutMs);
    this.unloadTimer.unref();
  }

  private clearUnloadTimer(): void {
    clearTimeout(this.unloadTimer);
    this.unloadTimer = undefined;
  }

  private terminate(): void {
    this.clearUnloadTimer();
    const child = this.child;
    this.child = undefined;
    this.ready = undefined;
    if (child && !child.kill() && child.pid === undefined) child.once('spawn', () => { child.kill(); });
  }
}
