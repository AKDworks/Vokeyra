import { readFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import * as ort from 'onnxruntime-node';
import vocabulary from '../../../resources/gigaam-v3-e2e-ctc-vocab.json';
import { validateWav } from '../../shared/wav';

// v3 E2E CTC: 16 kHz, periodic Hann 320, hop 160, 64 HTK mel bands,
// power spectrum, no centering/normalization, natural log clamped at 1e-9.
const windowSize = 320;
const bins = windowSize / 2 + 1;
const cos = new Float64Array(bins * windowSize);
const sin = new Float64Array(bins * windowSize);
for (let k = 0; k < bins; k++) for (let n = 0; n < windowSize; n++) {
  const hann = .5 - .5 * Math.cos(2 * Math.PI * n / windowSize);
  const angle = 2 * Math.PI * k * n / windowSize;
  cos[k * windowSize + n] = Math.cos(angle) * hann;
  sin[k * windowSize + n] = Math.sin(angle) * hann;
}
const melPoints = Float64Array.from({ length: 66 }, (_, i) => 700 * (10 ** ((2595 * Math.log10(1 + 8000 / 700) * i / 65) / 2595) - 1));
const filters = Array.from({ length: 64 }, (_, m) => {
  const weights: [number, number][] = [];
  for (let k = 0; k < bins; k++) {
    const hz = k * 16000 / windowSize;
    const weight = Math.max(0, Math.min((hz - melPoints[m]!) / (melPoints[m + 1]! - melPoints[m]!),
      (melPoints[m + 2]! - hz) / (melPoints[m + 2]! - melPoints[m + 1]!)));
    if (weight) weights.push([k, weight]);
  }
  return weights;
});
function features(samples: Float32Array): { values: Float32Array; frames: number } {
  const frames = Math.max(1, Math.floor((samples.length - windowSize) / 160) + 1);
  const values = new Float32Array(64 * frames);
  const power = new Float64Array(bins);
  for (let frame = 0; frame < frames; frame++) {
    const offset = frame * 160;
    for (let k = 0; k < bins; k++) {
      let real = 0, imaginary = 0;
      const base = k * windowSize;
      for (let n = 0; n < windowSize; n++) {
        const sample = samples[offset + n] ?? 0;
        real += sample * cos[base + n]!; imaginary += sample * sin[base + n]!;
      }
      power[k] = real * real + imaginary * imaginary;
    }
    for (let m = 0; m < 64; m++) {
      let value = 0;
      for (const [k, weight] of filters[m]!) value += power[k]! * weight;
      values[m * frames + frame] = Math.log(Math.max(1e-9, Math.min(1e9, value)));
    }
  }
  return { values, frames };
}
function parseVocabulary(value: string): Map<number, string> { return new Map(value.trim().split('\n').map(line => {
  const split = line.lastIndexOf(' '); return [Number(line.slice(split + 1)), line.slice(0, split).replaceAll('▁', ' ')] as const;
})); }
function decode(output: ort.Tensor, frames: number, tokens: Map<number, string>, blank: number, skipZero: boolean): string {
  const classes = blank + 1;
  if (output.dims.length !== 3 || output.dims[0] !== 1 || output.dims[2] !== classes) throw new Error('Неожиданный формат модели GigaAM.');
  const data = output.data as Float32Array;
  let previous = blank, text = '';
  const steps = Math.min(output.dims[1]!, Math.floor((frames - 1) / 4) + 1);
  for (let step = 0; step < steps; step++) {
    let best = 0;
    for (let token = 1; token < classes; token++) if (data[step * classes + token]! > data[step * classes + best]!) best = token;
    if (best !== blank && best !== previous && (!skipZero || best !== 0)) text += tokens.get(best) ?? '';
    previous = best;
  }
  return text.replace(/\s+([.,!?;:])/gu, '$1').replace(/\s+/gu, ' ').trim();
}
function cutPoint(samples: Float32Array, start: number): number {
  const end = Math.min(samples.length, start + 24 * 16000);
  if (end === samples.length) return end;
  let best = end, lowest = Infinity;
  for (let offset = end - 4 * 16000; offset + 320 <= end; offset += 160) {
    let energy = 0;
    for (let i = offset; i < offset + 320; i++) energy += samples[i]! ** 2;
    if (energy < lowest) { lowest = energy; best = offset + 160; }
  }
  return best;
}
function append(previous: string, next: string): string {
  if (!previous) return next;
  const left = previous.split(/\s+/), right = next.split(/\s+/);
  const normalize = (text: string) => text.toLocaleLowerCase('ru').replace(/[^\p{L}\p{N}]/gu, '');
  for (let count = Math.min(12, left.length, right.length); count > 0; count--) {
    if (left.slice(-count).every((word, i) => normalize(word) === normalize(right[i]!))) return `${previous} ${right.slice(count).join(' ')}`.trim();
  }
  return `${previous} ${next}`.trim();
}
const engine = process.argv[2], modelPath = process.argv[3];
if (!modelPath) throw new Error('Не передана модель GigaAM.');
const multilingual = engine === 'gigaam-multilingual-ctc';
ort.env.logLevel = 'error';
const tokensPromise = multilingual
  ? readFile(join(dirname(modelPath), 'multilingual_vocab.txt'), 'utf8').then(parseVocabulary)
  : Promise.resolve(parseVocabulary(vocabulary));
const sessionPromise = ort.InferenceSession.create(modelPath, {
  executionProviders: ['cpu'],
  intraOpNumThreads: Math.min(4, availableParallelism()),
  interOpNumThreads: 1,
  graphOptimizationLevel: 'all',
});

async function transcribe(wavPath: string): Promise<string> {
  const [tokens, session] = await Promise.all([tokensPromise, sessionPromise]);
  const blank = multilingual ? 70 : 256;
  const wav = Uint8Array.from(await readFile(wavPath)).buffer; validateWav(wav);
  const pcm = new DataView(wav);
  const samples = Float32Array.from({ length: (wav.byteLength - 44) / 2 }, (_, i) => pcm.getInt16(44 + i * 2, true) / 32768);
  let text = '';
  for (let start = 0; start < samples.length;) {
    const end = cutPoint(samples, start);
    const feature = features(samples.subarray(start, end));
    const result = await session.run({ features: new ort.Tensor('float32', feature.values, [1, 64, feature.frames]),
      feature_lengths: new ort.Tensor('int64', BigInt64Array.of(BigInt(feature.frames)), [1]) });
    if (!result.log_probs) throw new Error('Нет результата GigaAM.');
    text = append(text, decode(result.log_probs, feature.frames, tokens, blank, !multilingual));
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
    catch (error) { port.postMessage({ id, error: `GigaAM: ${error instanceof Error ? error.message : String(error)}` }); }
  });
});
