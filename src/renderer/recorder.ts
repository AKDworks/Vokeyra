import workletUrl from './recorder.worklet.js?url';
import { encodeWav } from '../shared/wav';
import { MAX_RECORDING_SECONDS, type Settings } from '../shared/contracts';
import { microphoneAccessDenied, MicrophoneAccessError } from './microphone-errors';
import { microphoneLevel } from '../shared/audio-level';

export interface RecorderTimings {
  requestMs?: number;
  workletMs?: number;
  resumeMs?: number;
}

function withTimeout<T>(promise: Promise<T>, timeout: number, message: string,
  onLate?: (value: T) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error(message));
      // The regular handler below releases a late result exactly once.
    }, timeout);
    promise.then(value => {
      if (settled) { onLate?.(value); return; }
      settled = true; clearTimeout(timer); resolve(value);
    }, error => {
      if (settled) return;
      settled = true; clearTimeout(timer); reject(error);
    });
  });
}

function stopTracks(stream: MediaStream): void {
  stream.getTracks().forEach(track => track.stop());
}

export class MicrophoneRecorder {
  constructor(private timings: RecorderTimings = {}) {}
  private stream?: MediaStream;
  private context?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private node?: AudioWorkletNode;
  private chunks: Float32Array[] = [];
  private count = 0;
  private level = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private cancelled = false;
  private flushed?: () => void;
  async start(onLimit: () => void, onLevel: (level: number) => void = () => {}, options: Pick<Settings, 'microphoneId' | 'inputChannel'> = { microphoneId: 'default', inputChannel: 'all' }): Promise<void> {
    try {
      let stream: MediaStream;
      try {
        stream = await withTimeout(navigator.mediaDevices.getUserMedia({ audio: {
          deviceId: options.microphoneId === 'default' ? undefined : { exact: options.microphoneId },
          channelCount: options.inputChannel === 'second' ? { exact: 2 } : { ideal: 2 },
          echoCancellation: false, noiseSuppression: false, autoGainControl: false,
        }, video: false }), this.timings.requestMs ?? 10_000, 'Микрофон не отвечает. Проверьте доступ и выбранное устройство.', stopTracks);
      } catch (err) {
        if (options.microphoneId !== 'default') {
          stream = await withTimeout(navigator.mediaDevices.getUserMedia({ audio: {
            channelCount: options.inputChannel === 'second' ? { exact: 2 } : { ideal: 2 },
            echoCancellation: false, noiseSuppression: false, autoGainControl: false,
          }, video: false }), this.timings.requestMs ?? 10_000, 'Микрофон не отвечает. Проверьте доступ и выбранное устройство.', stopTracks);
        } else {
          throw err;
        }
      }
      if (this.cancelled) { stream.getTracks().forEach(track => track.stop()); throw new Error('Запись отменена.'); }
      this.stream = stream;
      this.context = new AudioContext({ sampleRate: 16000 });
      if (this.context.sampleRate !== 16000) throw new Error('Устройство не поддерживает запись 16 кГц.');
      await withTimeout(this.context.audioWorklet.addModule(workletUrl), this.timings.workletMs ?? 5_000, 'Не удалось подготовить обработку микрофона.');
      if (this.cancelled) throw new Error('Запись отменена.');
      this.node = new AudioWorkletNode(this.context, 'pcm-recorder', { processorOptions: { inputChannel: options.inputChannel } });
      this.node.port.onmessage = (event: MessageEvent<Float32Array | string | { type: 'level'; rms: number }>) => {
        if (event.data === 'stopped') { this.flushed?.(); return; }
        if (event.data instanceof Float32Array) {
          const chunk = event.data.subarray(0, Math.max(0, MAX_RECORDING_SECONDS * 16000 - this.count));
          this.chunks.push(chunk); this.count += chunk.length;
        } else if (typeof event.data === 'object' && event.data.type === 'level') {
          const target = microphoneLevel(event.data.rms);
          this.level += (target - this.level) * (target > this.level ? .85 : .45);
          onLevel(this.level);
        }
      };
      const channels = stream.getAudioTracks()[0]?.getSettings().channelCount;
      if (options.inputChannel === 'second' && channels !== undefined && channels < 2) throw new Error('У микрофона нет второго канала. Выберите первый или все каналы.');
      this.source = this.context.createMediaStreamSource(stream);
      this.source.connect(this.node);
      // Worklet emits silence; the microphone is never played through the speakers.
      this.node.connect(this.context.destination);
      const context = this.context;
      await withTimeout(context.resume(), this.timings.resumeMs ?? 5_000, 'Не удалось включить микрофон. Закройте другие программы, использующие его.', () => { void context.close().catch(() => {}); });
      this.timer = setTimeout(onLimit, MAX_RECORDING_SECONDS * 1000);
    } catch (error) {
      await this.dispose();
      if (error instanceof DOMException && error.name === 'OverconstrainedError') throw new Error('Микрофон недоступен или не поддерживает выбранный канал. Проверьте настройки звука.');
      if (microphoneAccessDenied(error)) throw new MicrophoneAccessError();
      throw error;
    }
  }
  async stop(): Promise<ArrayBuffer> {
    clearTimeout(this.timer);
    if (this.node) {
      await new Promise<void>(resolve => {
        const timeout = setTimeout(resolve, 1500);
        this.flushed = () => { clearTimeout(timeout); resolve(); };
        this.node!.port.postMessage('stop');
      });
    }
    const samples = new Float32Array(this.count);
    let offset = 0;
    for (const chunk of this.chunks) { samples.set(chunk, offset); offset += chunk.length; }
    await this.dispose();
    return encodeWav(samples);
  }
  async dispose(): Promise<void> {
    this.cancelled = true;
    clearTimeout(this.timer);
    this.stream?.getTracks().forEach(track => track.stop());
    this.source?.disconnect();
    this.node?.disconnect();
    this.node?.port.close();
    if (this.context && this.context.state !== 'closed') await this.context.close();
    this.chunks = []; this.count = 0;
  }
}
