export interface TranscriptionRequest {
  executable: string;
  modelPath: string;
  wavPath: string;
  outputPrefix: string;
  language: string;
  vocabulary: string[];
  signal: AbortSignal;
}
export interface SpeechEngine {
  readonly id: string;
  transcribe(request: TranscriptionRequest): Promise<string>;
  setIdleTimeout?(timeoutMs: number | null): void;
  unload?(): void | Promise<void>;
}
export class EngineRegistry {
  private engines = new Map<string, SpeechEngine>();
  private idleTimeoutMs: number | null = 5 * 60_000;

  register(engine: SpeechEngine): void {
    engine.setIdleTimeout?.(this.idleTimeoutMs);
    this.engines.set(engine.id, engine);
  }
  has(id: string): boolean { return this.engines.has(id); }
  get(id: string): SpeechEngine {
    const engine = this.engines.get(id);
    if (!engine) throw new Error(`Движок ${id} пока не поддерживается.`);
    return engine;
  }
  setIdleTimeout(timeoutMs: number | null): void {
    this.idleTimeoutMs = timeoutMs;
    for (const engine of this.engines.values()) engine.setIdleTimeout?.(timeoutMs);
  }
  async unload(id: string): Promise<void> { await this.engines.get(id)?.unload?.(); }
  async unloadAll(): Promise<void> {
    await Promise.all([...this.engines.values()].map(engine => engine.unload?.()));
  }
}
