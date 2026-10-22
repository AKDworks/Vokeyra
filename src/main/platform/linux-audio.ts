import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { microphoneLevel } from '../../shared/audio-level';
import { encodeWav } from '../../shared/wav';
import { MAX_RECORDING_SECONDS } from '../../shared/contracts';

export interface LinuxCaptureOptions {
  microphoneId: string;
  inputChannel: 'all' | 'first' | 'second';
  onLevel: (level: number, seconds: number) => void;
  onLimit: () => void;
}

const SAMPLE_RATE = 16_000;

/**
 * Linux microphone capture outside the WebView.
 *
 * WebKitGTK suspends microphone access when its window is hidden, which is the
 * normal state for tray/autostart use on niri. Recording through PipeWire /
 * PulseAudio keeps hotkey dictation working while the main window is hidden.
 */
export class LinuxAudioCapture {
  private child?: ChildProcessByStdio<null, Readable, Readable>;
  private chunks: Buffer[] = [];
  private levelCarry = Buffer.alloc(0);
  private startedAt = 0;
  private timer?: NodeJS.Timeout;
  private levelEnergy = 0;
  private levelSamples = 0;
  private stopped = false;
  private failure?: Error;

  async start(options: LinuxCaptureOptions): Promise<void> {
    const requested = options.microphoneId;
    // WebKit exposes opaque device ids. They are not PulseAudio source names,
    // so an unavailable id falls back to the system default source instead of
    // leaving dictation broken.
    try {
      await this.launch(requested === 'default' ? '@DEFAULT_SOURCE@' : requested, options);
    } catch (error) {
      if (requested === 'default') throw error;
      this.reset();
      await this.launch('@DEFAULT_SOURCE@', options);
    }
    this.timer = setTimeout(options.onLimit, MAX_RECORDING_SECONDS * 1000);
  }

  private reset(): void {
    this.child?.kill('SIGTERM');
    this.child = undefined;
    this.chunks = [];
    this.levelCarry = Buffer.alloc(0);
    this.levelEnergy = 0;
    this.levelSamples = 0;
    this.failure = undefined;
  }

  private async launch(device: string, options: LinuxCaptureOptions): Promise<void> {
    const child = spawn('parec', [
      '--format=s16le',
      `--rate=${SAMPLE_RATE}`,
      '--channels=2',
      '--latency-msec=40',
      '--client-name=Vokeyra',
      '--stream-name=Vokeyra recording',
      `--device=${device}`,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    this.startedAt = Date.now();
    child.stdout.on('data', (data: Buffer) => this.consume(data, options));
    child.stderr.on('data', data => {
      const text = String(data).trim();
      if (text) this.failure = new Error(`Микрофон: ${text.slice(-300)}`);
    });
    child.once('error', error => { this.failure = error; });
    child.once('exit', code => {
      if (!this.stopped && code !== 0 && !this.failure) {
        this.failure = new Error('Не удалось начать запись с микрофона.');
      }
    });
    // parec reports a missing/unavailable device by exiting immediately. Probe
    // briefly so the UI does not stay in "Микрофон…" forever.
    await new Promise<void>(resolve => setTimeout(resolve, 200));
    if (this.failure) throw this.failure;
    if (child.exitCode !== null) throw new Error('Не удалось начать запись с микрофона.');
  }

  private consume(data: Buffer, options: LinuxCaptureOptions): void {
    this.chunks.push(data);
    const combined = this.levelCarry.length ? Buffer.concat([this.levelCarry, data]) : data;
    const usable = combined.length - (combined.length % 4);
    this.levelCarry = Buffer.from(combined.subarray(usable));
    for (let offset = 0; offset + 3 < usable; offset += 4) {
      const left = combined.readInt16LE(offset) / 32768;
      const right = combined.readInt16LE(offset + 2) / 32768;
      const sample = options.inputChannel === 'first' ? left
        : options.inputChannel === 'second' ? right : (left + right) / 2;
      this.levelEnergy += sample * sample;
      if (++this.levelSamples >= 640) {
        const level = microphoneLevel(Math.sqrt(this.levelEnergy / this.levelSamples));
        this.levelEnergy = 0;
        this.levelSamples = 0;
        options.onLevel(level, (Date.now() - this.startedAt) / 1000);
      }
    }
  }

  async stop(inputChannel: 'all' | 'first' | 'second'): Promise<ArrayBuffer> {
    this.stopped = true;
    clearTimeout(this.timer);
    const child = this.child;
    if (child && child.exitCode === null) {
      await new Promise<void>(resolve => {
        const timeout = setTimeout(resolve, 1500);
        child.once('exit', () => { clearTimeout(timeout); resolve(); });
        child.kill('SIGTERM');
      });
    }
    this.child = undefined;
    const all = this.chunks.length ? Buffer.concat(this.chunks) : Buffer.alloc(0);
    return encodeWav(pcm16StereoToMono(all, inputChannel));
  }
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
