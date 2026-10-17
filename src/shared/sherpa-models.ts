// The same engine list drives registration, language checks, and runtime labels.
export const sherpaModels = {
  'gigaam-v3-e2e-rnnt': ['ru'],
  'parakeet-tdt-0-6b-v3-int8': ['en', 'es', 'fr', 'de', 'bg', 'hr', 'cs', 'da', 'nl', 'et', 'fi', 'el', 'hu', 'it', 'lv', 'lt', 'mt', 'pl', 'pt', 'ro', 'sk', 'sl', 'sv', 'ru', 'uk'],
  'moonshine-tiny-en-int8': ['en'],
  'moonshine-base-en-int8': ['en'],
  'sensevoice-small-int8': ['zh', 'en', 'ja', 'ko', 'yue'],
  'vosk-small-ru-int8': ['ru'],
  'zipformer-gigaspeech-en-int8': ['en'],
} as const;

export type SherpaEngineId = keyof typeof sherpaModels;
export const isSherpaEngine = (id: string): id is SherpaEngineId => Object.hasOwn(sherpaModels, id);
