import { readFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { validateWav } from '../../shared/wav';

type Recognizer = {
  createStream(): { acceptWaveform(value: { sampleRate: number; samples: Float32Array }): void };
  decode(stream: unknown): void;
  getResult(stream: unknown): { text?: string };
};
type Sherpa = { OfflineRecognizer: new (config: Record<string, unknown>) => Recognizer };
// sherpa-onnx-node is CommonJS and provides its native Windows addon at runtime.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sherpa = require('sherpa-onnx-node') as Sherpa;

const engineArg = process.argv[2], modelDirectoryArg = process.argv[3], wavPathArg = process.argv[4];
if (!engineArg || !modelDirectoryArg || !wavPathArg) throw new Error('Не переданы файлы движка распознавания.');
const engine = engineArg, modelDirectory = modelDirectoryArg, wavPath = wavPathArg;

function config(): Record<string, unknown> {
  const common = { numThreads: Math.min(4, availableParallelism()), provider: 'cpu', debug: 0 };
  if (engine === 'moonshine-tiny-en-int8') return {
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: { moonshine: {
      preprocessor: join(modelDirectory, 'preprocess.onnx'), encoder: join(modelDirectory, 'encode.int8.onnx'),
      uncachedDecoder: join(modelDirectory, 'uncached_decode.int8.onnx'), cachedDecoder: join(modelDirectory, 'cached_decode.int8.onnx'),
    }, tokens: join(modelDirectory, 'tokens.txt'), ...common },
  };
  const names = engine === 'gigaam-v3-e2e-rnnt'
    ? { encoder: 'encoder.int8.onnx', decoder: 'decoder.onnx', joiner: 'joiner.onnx', featureDim: 64 }
    : { encoder: 'encoder.int8.onnx', decoder: 'decoder.int8.onnx', joiner: 'joiner.int8.onnx', featureDim: 80 };
  return {
    featConfig: { sampleRate: 16000, featureDim: names.featureDim }, decodingMethod: 'greedy_search', maxActivePaths: 1,
    modelConfig: { transducer: {
      encoder: join(modelDirectory, names.encoder), decoder: join(modelDirectory, names.decoder), joiner: join(modelDirectory, names.joiner),
    }, tokens: join(modelDirectory, 'tokens.txt'), modelType: 'nemo_transducer', ...common },
  };
}

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

async function main(): Promise<string> {
  const bytes = Uint8Array.from(await readFile(wavPath));
  validateWav(bytes.buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = Float32Array.from({ length: (bytes.byteLength - 44) / 2 }, (_, index) => view.getInt16(44 + index * 2, true) / 32768);
  const recognizer = new sherpa.OfflineRecognizer(config());
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

const send = (message: { text?: string; error?: string }) => process.parentPort
  ? process.parentPort.postMessage(message) : console.log(JSON.stringify(message));
void main().then(text => send({ text }), error => send({ error: `Модель: ${error instanceof Error ? error.message : String(error)}` }));
