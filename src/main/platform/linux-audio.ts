import { spawn } from 'node:child_process';
import type { Readable } from 'node:stream';
import { microphoneLevel } from '../../shared/audio-level';
import { encodeWav } from '../../shared/wav';
import { MAX_RECORDING_SECONDS, type AudioSource } from '../../shared/contracts';
import type { LinuxCommand } from './linux-native';

export interface LinuxCaptureOptions {
  microphoneId: string;
  inputChannel: 'all' | 'first' | 'second';
  onLevel: (level: number, seconds: number) => void;
  onLimit: () => void;
  /** Called when the selected source is unavailable and the default is used. */
  onFallback?: (error: Error) => void;
  /** Called once if parec fails after a successful start. */
  onError?: (error: Error) => void;
  allowFallback?: boolean;
}

export interface CaptureProcess {
  stdout: Readable;
  stderr: Readable;
  exitCode: number | null;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  once(event: 'error', listener: (error: Error) => void): this;
  once(event: 'spawn', listener: () => void): this;
}

export type CaptureSpawner = (args: string[]) => CaptureProcess;

export interface CaptureTimings {
  maxSeconds?: number;
  probeMs?: number;
}

const SAMPLE_RATE = 16_000;
const DEFAULT_PROBE_MS = 200;

/**
 * Linux microphone capture outside the WebView.
 *
 * WebKitGTK suspends microphone access when its window is hidden, which is the
 * normal state for tray/autostart use on niri. Recording through PipeWire /
 * PulseAudio keeps hotkey dictation working while the main window is hidden.
 */
export class LinuxAudioCapture {
  private child?: CaptureProcess;
  private chunks: Buffer[] = [];
  private levelCarry = Buffer.alloc(0);
  private storeCarry = Buffer.alloc(0);
  private savedFrames = 0;
  private startedAt = 0;
  private timer?: NodeJS.Timeout;
  private levelEnergy = 0;
  private levelSamples = 0;
  private generation = 0;
  private started = false;
  private stopped = false;
  private starting = true;
  private expectedExit = false;
  private limitNotified = false;
  private failure?: Error;
  private errorNotified = false;
  private onError?: (error: Error) => void;
  private readonly maxFrames: number;
  private readonly probeMs: number;
  private readonly spawner: CaptureSpawner;

  constructor(spawner: CaptureSpawner = defaultSpawner, timings: CaptureTimings = {}) {
    this.spawner = spawner;
    this.maxFrames = Math.floor((timings.maxSeconds ?? MAX_RECORDING_SECONDS) * SAMPLE_RATE);
    this.probeMs = timings.probeMs ?? DEFAULT_PROBE_MS;
  }

  get error(): Error | undefined {
    return this.failure;
  }

  get limited(): boolean {
    return this.limitNotified;
  }

  async start(options: LinuxCaptureOptions): Promise<void> {
    if (this.started) throw new Error('Захват микрофона уже запущен.');
    this.started = true;
    const generation = ++this.generation;
    this.startedAt = Date.now();
    // Start the limit before spawning: PCM is accumulated from the first byte,
    // not after the backend finishes its preparation.
    this.timer = setTimeout(() => this.hitLimit(generation, options), Math.max(0.001, this.maxFrames / SAMPLE_RATE) * 1000);
    const requested = options.microphoneId === 'default' ? '@DEFAULT_SOURCE@' : options.microphoneId;
    try {
      await this.launch(requested, options, generation);
      if (!this.active(generation)) throw cancelled();
    } catch (error) {
      if (!this.active(generation)) throw cancelled();
      await this.terminate();
      if (!this.active(generation)) throw cancelled();
      if (requested !== '@DEFAULT_SOURCE@' && options.allowFallback !== false) {
        this.resetBuffers();
        options.onFallback?.(asError(error));
        await this.launch('@DEFAULT_SOURCE@', options, generation);
        if (!this.active(generation)) throw cancelled();
      } else {
        throw error;
      }
    } finally {
      this.starting = false;
    }
    if (this.failure) throw this.failure;
    if (!this.active(generation)) {
      await this.terminate();
      throw cancelled();
    }
  }

  private active(generation: number): boolean {
    return !this.stopped && generation === this.generation;
  }

  private async launch(device: string, options: LinuxCaptureOptions, generation: number): Promise<void> {
    if (!this.active(generation)) throw cancelled();
    this.failure = undefined;
    this.expectedExit = false;
    this.errorNotified = false;
    this.onError = options.onError;
    const child = this.spawner([
      '--format=s16le',
      `--rate=${SAMPLE_RATE}`,
      '--channels=2',
      '--latency-msec=40',
      '--client-name=Vokeyra',
      '--stream-name=Vokeyra recording',
      `--device=${device}`,
    ]);
    this.child = child;
    this.startedAt = Date.now();
    child.stdout.on('data', (data: Buffer) => {
      if (this.child === child && this.active(generation) && !this.limitNotified) this.consume(data, options, generation);
    });
    child.stderr.on('data', data => {
      if (this.child !== child || !this.active(generation) || this.expectedExit) return;
      const text = String(data).trim();
      if (text) this.failure = new Error(`Микрофон: ${text.slice(-300)}`);
    });
    child.once('error', error => {
      if (this.child !== child || !this.active(generation)) return;
      this.failure = error;
      if (!this.starting) this.notifyError(error);
    });
    child.once('exit', (code, signal) => {
      if (this.child !== child || !this.active(generation) || this.expectedExit) return;
      const reason = signal ? `сигнал ${signal}` : `код ${code ?? 'неизвестен'}`;
      const error = new Error(`Захват микрофона неожиданно завершился (${reason}).`);
      this.failure = error;
      clearTimeout(this.timer);
      if (!this.starting) this.notifyError(error);
    });
    // parec reports a missing/unavailable device by exiting immediately. Probe
    // briefly so the UI does not stay in "Микрофон…" forever.
    await new Promise<void>(resolve => setTimeout(resolve, this.probeMs));
    if (!this.active(generation)) throw cancelled();
    if (this.failure) throw this.failure;
    if (child.exitCode !== null) throw new Error('Не удалось начать запись с микрофона.');
  }

  private notifyError(error: Error): void {
    if (this.errorNotified) return;
    this.errorNotified = true;
    this.expectedExit = true;
    // The process is already gone, but make sure no further chunks are stored.
    try { this.child?.kill('SIGTERM'); } catch { /* already exited */ }
    this.onError?.(error);
  }

  private consume(data: Buffer, options: LinuxCaptureOptions, generation: number): void {
    if (!this.active(generation) || this.limitNotified) return;
    // Level metering uses the same PCM stream but tracks its own alignment.
    const levelData = this.levelCarry.length ? Buffer.concat([this.levelCarry, data]) : data;
    const levelUsable = levelData.length - (levelData.length % 4);
    this.levelCarry = Buffer.from(levelData.subarray(levelUsable));
    for (let offset = 0; offset + 3 < levelUsable; offset += 4) {
      const left = levelData.readInt16LE(offset) / 32768;
      const right = levelData.readInt16LE(offset + 2) / 32768;
      const sample = options.inputChannel === 'first' ? left
        : options.inputChannel === 'second' ? right : (left + right) / 2;
      this.levelEnergy += sample * sample;
      if (++this.levelSamples >= 640) {
        const level = microphoneLevel(Math.sqrt(this.levelEnergy / this.levelSamples));
        this.levelEnergy = 0;
        this.levelSamples = 0;
        if (this.active(generation) && !this.limitNotified) {
          options.onLevel(level, (Date.now() - this.startedAt) / 1000);
        }
      }
    }

    // Store only complete frames and never more than the allowed duration.
    const stored = this.storeCarry.length ? Buffer.concat([this.storeCarry, data]) : data;
    const complete = stored.length - (stored.length % 4);
    const remaining = Math.max(0, (this.maxFrames - this.savedFrames) * 4);
    const keep = Math.min(complete, remaining);
    if (keep > 0) {
      this.chunks.push(Buffer.from(stored.subarray(0, keep)));
      this.savedFrames += keep / 4;
    }
    this.storeCarry = keep < complete ? Buffer.alloc(0) : Buffer.from(stored.subarray(keep));
    if (this.savedFrames >= this.maxFrames) this.hitLimit(generation, options);
  }

  private hitLimit(generation: number, options: LinuxCaptureOptions): void {
    if (!this.active(generation) || this.limitNotified) return;
    this.limitNotified = true;
    this.expectedExit = true;
    clearTimeout(this.timer);
    try { this.child?.kill('SIGTERM'); } catch { /* already exited */ }
    options.onLimit();
  }

  async stop(inputChannel: 'all' | 'first' | 'second'): Promise<ArrayBuffer> {
    this.stopped = true;
    ++this.generation;
    this.expectedExit = true;
    clearTimeout(this.timer);
    await this.terminate();
    const all = this.chunks.length ? Buffer.concat(this.chunks) : Buffer.alloc(0);
    const frames = Math.min(this.maxFrames, Math.floor(all.length / 4));
    return encodeWav(pcm16StereoToMono(all.subarray(0, frames * 4), inputChannel));
  }

  private async terminate(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    if (!child || child.exitCode !== null) return;
    await new Promise<void>(resolve => {
      const timeout = setTimeout(resolve, 1500);
      child.once('exit', () => { clearTimeout(timeout); resolve(); });
      try { child.kill('SIGTERM'); } catch { clearTimeout(timeout); resolve(); }
    });
  }

  private resetBuffers(): void {
    this.chunks = [];
    this.savedFrames = 0;
    this.storeCarry = Buffer.alloc(0);
    this.levelCarry = Buffer.alloc(0);
    this.levelEnergy = 0;
    this.levelSamples = 0;
  }
}

function cancelled(): Error {
  return new Error('Запись отменена.');
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function defaultSpawner(args: string[]): CaptureProcess {
  return spawn('parec', args, { stdio: ['ignore', 'pipe', 'pipe'] }) as unknown as CaptureProcess;
}

/** Convert interleaved stereo PCM16 to mono, selecting the requested channel. */
export function pcm16StereoToMono(data: Buffer, channel: 'all' | 'first' | 'second'): Float32Array {
  const usable = data.length - (data.length % 4);
  const mono = new Float32Array(usable / 4);
  for (let offset = 0, index = 0; offset + 3 < usable; offset += 4, index++) {
    const left = data.readInt16LE(offset) / 32768;
    const right = data.readInt16LE(offset + 2) / 32768;
    mono[index] = channel === 'first' ? left : channel === 'second' ? right : (left + right) / 2;
  }
  return mono;
}

/** Parse `pactl list sources` into stable PulseAudio source names and labels. */
export function parsePactlSources(output: string): AudioSource[] {
  const sources: AudioSource[] = [];
  for (const block of output.split(/\n(?=Source #)/)) {
    const name = block.match(/^\s*Name:\s*(.+)$/m)?.[1]?.trim();
    const description = block.match(/^\s*Description:\s*(.+)$/m)?.[1]?.trim();
    if (name) sources.push({ id: name, label: description || name });
  }
  return sources;
}

export function needsMicrophoneMigration(id: string, sources: AudioSource[]): boolean {
  return id !== 'default' && sources.length > 0 && !sources.some(source => source.id === id);
}

/** List sources through the same PulseAudio/PipeWire backend used for capture. */
export async function listLinuxSources(run: LinuxCommand): Promise<AudioSource[]> {
  try {
    return parsePactlSources(await run('pactl', ['list', 'sources'], { timeout: 3000 }));
  } catch {
    return [];
  }
}
