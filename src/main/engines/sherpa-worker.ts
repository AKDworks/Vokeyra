import { readFile } from 'node:fs/promises';
import { validateWav } from '../../shared/wav';
import { sherpaConfig } from './sherpa-config';

type Recognizer = {
  createStream(): { acceptWaveform(value: { sampleRate: number; samples: Float32Array }): void };
  decode(stream: unknown): void;
  getResult(stream: unknown): { text?: string };
};
type Sherpa = { OfflineRecognizer: new (config: Record<string, unknown>) => Recognizer };
// sherpa-onnx-node is CommonJS and provides a native addon at runtime.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sherpa = require('sherpa-onnx-node') as Sherpa;

const engineArg = process.argv[2], modelDirectoryArg = process.argv[3];
if (!engineArg || !modelDirectoryArg) throw new Error('Не переданы файлы движка распознавания.');
const engine = engineArg, modelDirectory = modelDirectoryArg;

function append(previous: string, next: string): string {
  if (!previous) return next;
  const left = previous.split(/\s+/), right = next.split(/\s+/);
  const normalize = (text: string) => text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  for (let count = Math.min(12, left.length, right.length); count > 0; count--) {
    if (left.slice(-count).every((word, index) => normalize(word) === normalize(right[index]!))) {
      return `${previous} ${right.slice(count).join(' ')}`.trim();
    }
  }
  return `${previous} ${next}`.trim();
}

function cutPoint(samples: Float32Array, start: number): number {
  const end = Math.min(samples.length, start + 25 * 16000);
  if (end === samples.length) return end;
  let best = end, lowest = Infinity;
  for (let offset = end - 4 * 16000; offset + 320 <= end; offset += 160) {
    let energy = 0;
    for (let index = offset; index < offset + 320; index++) energy += samples[index]! ** 2;
    if (energy < lowest) { lowest = energy; best = offset + 160; }
  }
  return best;
}

const recognizer = new sherpa.OfflineRecognizer(sherpaConfig(engine, modelDirectory, process.argv[4] ?? 'auto'));
async function transcribe(wavPath: string): Promise<string> {
  const bytes = Uint8Array.from(await readFile(wavPath));
  validateWav(bytes.buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = Float32Array.from({ length: (bytes.byteLength - 44) / 2 }, (_, index) => view.getInt16(44 + index * 2, true) / 32768);
  let text = '';
  for (let start = 0; start < samples.length;) {
    const end = cutPoint(samples, start);
    const stream = recognizer.createStream();
    stream.acceptWaveform({ sampleRate: 16000, samples: samples.subarray(start, end) });
    recognizer.decode(stream);
    text = append(text, recognizer.getResult(stream).text?.trim() ?? '');
    if (end === samples.length) break;
    start = Math.max(start + 1, end - 5600);
  }
  return text;
}

if (!process.send) throw new Error('Модель запущена без служебного канала.');
const port = { on: process.on.bind(process), postMessage: (message: unknown) => process.send!(message as object) };
let queue = Promise.resolve();
port.on('message', event => {
  const value = event && typeof event === 'object' && 'data' in event ? (event as { data: unknown }).data : event;
  if (!value || typeof value !== 'object') return;
  const message = value as { id?: unknown; wavPath?: unknown };
  if (typeof message.id !== 'number' || typeof message.wavPath !== 'string') return;
  const id = message.id, wavPath = message.wavPath;
  queue = queue.then(async () => {
    try { port.postMessage({ id, text: await transcribe(wavPath) }); }
    catch (error) { port.postMessage({ id, error: `Модель: ${error instanceof Error ? error.message : String(error)}` }); }
  });
});
