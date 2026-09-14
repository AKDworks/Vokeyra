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
}
export class EngineRegistry {
  private engines = new Map<string, SpeechEngine>();
  register(engine: SpeechEngine): void { this.engines.set(engine.id, engine); }
  has(id: string): boolean { return this.engines.has(id); }
  get(id: string): SpeechEngine {
    const engine = this.engines.get(id);
    if (!engine) throw new Error(`Движок ${id} пока не поддерживается.`);
    return engine;
  }
}
