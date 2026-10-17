
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EngineRegistry, type SpeechEngine, type TranscriptionRequest } from '../src/main/engines/types';
import { ModelWorker, type WorkerProcess } from '../src/main/engines/worker-client';
import { join } from 'node:path';
import catalog from '../resources/models.json';
import { sherpaModels } from '../src/shared/sherpa-models';
import { sherpaConfig } from '../src/main/engines/sherpa-config';
import { SherpaEngine } from '../src/main/engines/sherpa';

describe('bundled sherpa packages', () => {
  it('uses only files actually shipped in each model package, with matching languages', () => {
    const root = join('models', 'test');
    function paths(value: unknown): string[] {
      if (typeof value === 'string') return value.startsWith(root) ? [value] : [];
      if (!value || typeof value !== 'object') return [];
      return Object.values(value).flatMap(paths);
    }
    for (const [id, languages] of Object.entries(sherpaModels)) {
      const model = catalog.models.find(item => item.engine === id)!;
      expect(model, `Missing package for ${id}`).toBeDefined();
      expect(model.languages).toEqual(languages);
      const files = model.artifacts.map(file => join(root, file.filename));
      const configured = paths(sherpaConfig(id, root));
      expect(configured.length).toBeGreaterThan(1);
      expect(files.sort()).toEqual(configured.sort());
    }
  });
  it('rejects an unavailable language before starting the model', async () => {
    const engine = new SherpaEngine('sensevoice-small-int8');
    await expect(engine.transcribe({ language: 'ru', signal: new AbortController().signal } as TranscriptionRequest)).rejects.toThrow('язык не поддерживается');
  });
});

class FakeProcess extends EventEmitter {
  pid: number | undefined = 123;
  stderr = null;
  posts: Array<{ id: number; wavPath: string }> = [];
  killed = false;

  constructor(private respond = true) {
    super();
    queueMicrotask(() => this.emit('spawn'));
  }
  postMessage(message: { id: number; wavPath: string }): void {
    this.posts.push(message);
    if (this.respond) queueMicrotask(() => this.emit('message', { id: message.id, text: `text:${message.wavPath}` }));
  }
  kill(): boolean {
    if (this.killed) return false;
    this.killed = true; this.pid = undefined;
    queueMicrotask(() => this.emit('exit', 0));
    return true;
  }
}

afterEach(() => vi.useRealTimers());

describe('persistent model workers', () => {
  it('reuses a loaded worker for consecutive transcriptions', async () => {
    const processes: FakeProcess[] = [];
    const worker = new ModelWorker(() => {
      const child = new FakeProcess(); processes.push(child); return child as unknown as WorkerProcess;
    }, 'Test engine');
    worker.setIdleTimeout(null);

    await expect(worker.run('first.wav', new AbortController().signal)).resolves.toBe('text:first.wav');
    await expect(worker.run('second.wav', new AbortController().signal)).resolves.toBe('text:second.wav');

    expect(processes).toHaveLength(1);
    expect(processes[0]!.posts).toHaveLength(2);
    worker.unload();
    expect(processes[0]!.killed).toBe(true);
  });

  it('unloads an idle model after the configured delay', async () => {
    vi.useFakeTimers();
    const child = new FakeProcess();
    const worker = new ModelWorker(() => child as unknown as WorkerProcess, 'Test engine');
    worker.setIdleTimeout(1000);

    const result = worker.run('sample.wav', new AbortController().signal);
    await vi.runAllTicks();
    await expect(result).resolves.toBe('text:sample.wav');
    await vi.advanceTimersByTimeAsync(999);
    expect(child.killed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(child.killed).toBe(true);
  });

  it('kills inference immediately when transcription is cancelled', async () => {
    const child = new FakeProcess(false);
    const worker = new ModelWorker(() => child as unknown as WorkerProcess, 'Test engine');
    const controller = new AbortController();
    const result = worker.run('sample.wav', controller.signal);
    await new Promise<void>(resolve => queueMicrotask(() => resolve()));
    controller.abort();

    await expect(result).rejects.toThrow('Распознавание отменено');
    expect(child.killed).toBe(true);
  });
});

describe('engine registry lifecycle', () => {
  it('applies unload timing and releases every registered engine', async () => {
    const first = { id: 'first', transcribe: vi.fn(), setIdleTimeout: vi.fn(), unload: vi.fn() } as unknown as SpeechEngine;
    const second = { id: 'second', transcribe: vi.fn(), setIdleTimeout: vi.fn(), unload: vi.fn() } as unknown as SpeechEngine;
    const engines = new EngineRegistry();
    engines.register(first); engines.register(second);
    engines.setIdleTimeout(15_000);
    await engines.unloadAll();

    expect(first.setIdleTimeout).toHaveBeenLastCalledWith(15_000);
    expect(second.setIdleTimeout).toHaveBeenLastCalledWith(15_000);
    expect(first.unload).toHaveBeenCalledOnce();
    expect(second.unload).toHaveBeenCalledOnce();
  });
});
