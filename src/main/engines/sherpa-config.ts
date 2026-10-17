import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { isSherpaEngine } from '../../shared/sherpa-models';

export function sherpaConfig(engine: string, directory: string, language = 'auto'): Record<string, unknown> {
  if (!isSherpaEngine(engine)) throw new Error(`Движок ${engine} пока не поддерживается.`);
  const common = { tokens: join(directory, 'tokens.txt'), numThreads: Math.min(4, availableParallelism()), provider: 'cpu', debug: 0 };
  if (engine === 'moonshine-tiny-en-int8' || engine === 'moonshine-base-en-int8') return {
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: { moonshine: {
      preprocessor: join(directory, 'preprocess.onnx'), encoder: join(directory, 'encode.int8.onnx'),
      uncachedDecoder: join(directory, 'uncached_decode.int8.onnx'), cachedDecoder: join(directory, 'cached_decode.int8.onnx'),
    }, ...common },
  };
  if (engine === 'sensevoice-small-int8') return {
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: { senseVoice: { model: join(directory, 'model.int8.onnx'), language, useInverseTextNormalization: 1 }, ...common },
  };
  const rnnt = engine === 'gigaam-v3-e2e-rnnt';
  const names = engine === 'zipformer-gigaspeech-en-int8'
    ? ['encoder-epoch-30-avg-1.int8.onnx', 'decoder-epoch-30-avg-1.int8.onnx', 'joiner-epoch-30-avg-1.int8.onnx']
    : ['encoder.int8.onnx', rnnt ? 'decoder.onnx' : 'decoder.int8.onnx', rnnt ? 'joiner.onnx' : 'joiner.int8.onnx'];
  return {
    featConfig: { sampleRate: 16000, featureDim: rnnt ? 64 : 80 }, decodingMethod: 'greedy_search', maxActivePaths: 1,
    modelConfig: { transducer: {
      encoder: join(directory, names[0]!), decoder: join(directory, names[1]!), joiner: join(directory, names[2]!),
    }, modelType: engine === 'vosk-small-ru-int8' || engine === 'zipformer-gigaspeech-en-int8' ? 'zipformer2' : 'nemo_transducer', ...common },
  };
}
