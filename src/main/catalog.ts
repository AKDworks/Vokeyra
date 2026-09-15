import type { Catalog, Model, ModelArtifact, ModelCapabilities } from '../shared/contracts';

export function httpsUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Некорректный URL.');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Нужна HTTPS-ссылка без логина и пароля.');
  return url.href;
}
function label(value: unknown, key: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 300) throw new Error(`Некорректное поле ${key}.`);
  return value;
}
function score(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1 || value > 5) throw new Error('Оценка модели должна быть от 1 до 5.');
  return value;
}
function safePath(value: unknown, key: string): string {
  const path = label(value, key).replaceAll('\\', '/');
  const invalidWindowsName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.toLowerCase() === 'installed.json'
    || path.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.')
      || /[<>:"|?*\u0000-\u001f]/.test(part) || /[. ]$/.test(part) || invalidWindowsName.test(part))) {
    throw new Error(`Некорректный путь ${key}.`);
  }
  return path;
}
function hash(value: unknown, id: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`Нет SHA-256 для ${id}.`);
  return value;
}
function bytes(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 20_000_000_000) throw new Error('Некорректный размер файла модели.');
  return Number(value);
}
function optionalBoolean(value: unknown, key: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new Error(`Некорректная возможность ${key}.`);
  return value;
}
function capabilities(value: unknown): ModelCapabilities | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Некорректные возможности модели.');
  const data = value as Record<string, unknown>;
  return {
    streaming: optionalBoolean(data.streaming, 'streaming'),
    translation: optionalBoolean(data.translation, 'translation'),
    languageDetection: optionalBoolean(data.languageDetection, 'languageDetection'),
    punctuation: optionalBoolean(data.punctuation, 'punctuation'),
  };
}
function artifacts(m: Record<string, unknown>, id: string, schemaVersion: number): { items: ModelArtifact[]; entrypoint: string } {
  if (schemaVersion === 1) {
    const digest = hash(m.sha256, id);
    const filename = `${digest}.bin`;
    return { items: [{ filename, format: 'file', sizeBytes: bytes(m.sizeBytes), url: httpsUrl(m.url), sha256: digest }], entrypoint: filename };
  }
  if (!Array.isArray(m.artifacts) || !m.artifacts.length || m.artifacts.length > 32) throw new Error(`У модели ${id} нет файлов.`);
  const names = new Set<string>();
  const items = m.artifacts.map((raw, index): ModelArtifact => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Некорректный файл модели ${id}.`);
    const item = raw as Record<string, unknown>;
    const filename = safePath(item.filename, `artifacts[${index}].filename`);
    if (names.has(filename.toLowerCase())) throw new Error(`Повторяющийся файл ${filename}.`);
    names.add(filename.toLowerCase());
    const format = item.format === undefined ? 'file' : item.format;
    if (format !== 'file' && format !== 'tar.gz') throw new Error(`Неподдерживаемый формат файла ${filename}.`);
    return { filename, format, sizeBytes: bytes(item.sizeBytes), url: httpsUrl(item.url), sha256: hash(item.sha256, id) };
  });
  return { items, entrypoint: safePath(m.entrypoint, 'entrypoint') };
}
export function parseCatalog(value: unknown): Catalog {
  if (!value || typeof value !== 'object') throw new Error('Некорректный каталог.');
  const data = value as Record<string, unknown>;
  if ((data.schemaVersion !== 1 && data.schemaVersion !== 2) || !Array.isArray(data.models) || data.models.length > 200) throw new Error('Неподдерживаемая схема каталога.');
  const schemaVersion = data.schemaVersion;
  const ids = new Set<string>();
  const models = data.models.map((raw: unknown): Model => {
    if (!raw || typeof raw !== 'object') throw new Error('Некорректная модель.');
    const m = raw as Record<string, unknown>;
    const id = label(m.id, 'id');
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(id) || ids.has(id)) throw new Error('ID модели должен быть уникальным и безопасным.');
    ids.add(id);
    if (!Array.isArray(m.languages) || !m.languages.length || m.languages.length > 120) throw new Error('Нужен список языков.');
    if (m.recommended !== undefined && typeof m.recommended !== 'boolean') throw new Error('Некорректная рекомендация.');
    const packageFiles = artifacts(m, id, schemaVersion);
    return {
      id, name: label(m.name, 'name'), developer: label(m.developer, 'developer'),
      engine: label(m.engine, 'engine'), version: label(m.version, 'version'),
      speed: label(m.speed, 'speed'), quality: label(m.quality, 'quality'),
      speedScore: score(m.speedScore), qualityScore: score(m.qualityScore),
      recommended: m.recommended as boolean | undefined,
      recommendationReason: m.recommendationReason === undefined ? undefined : label(m.recommendationReason, 'recommendationReason'),
      description: m.description === undefined ? undefined : label(m.description, 'description'),
      family: m.family === undefined ? undefined : label(m.family, 'family'),
      quantization: m.quantization === undefined ? undefined : label(m.quantization, 'quantization'),
      capabilities: capabilities(m.capabilities),
      languages: m.languages.map(l => label(l, 'languages')),
      sizeBytes: packageFiles.items.reduce((sum, item) => sum + item.sizeBytes, 0),
      license: label(m.license, 'license'), licenseUrl: httpsUrl(m.licenseUrl),
      sourceUrl: m.sourceUrl === undefined ? undefined : httpsUrl(m.sourceUrl),
      entrypoint: packageFiles.entrypoint, artifacts: packageFiles.items,
    };
  });
  if (models.filter(model => model.recommended).length > 5) throw new Error('В каталоге может быть не больше пяти рекомендуемых моделей.');
  return { schemaVersion: 2, models };
}
