import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { extract as extractTar } from 'tar';
import { parseCatalog } from './catalog';
import { atomicJson, readJson } from './storage';
import { downloadVerified } from './download';
import type { Catalog, DownloadState, InstalledModel, Model, ModelArtifact, ModelView } from '../shared/contracts';

function fingerprint(model: Model): string {
  return `${model.engine}:${model.entrypoint}:${model.artifacts.map(item => `${item.format}:${item.filename}:${item.sha256}`).join('|')}`;
}
function safeArchiveEntry(path: string): boolean {
  const normalized = path.replaceAll('\\', '/');
  const parts = normalized.split('/');
  if (!parts.at(-1)) parts.pop();
  const invalidWindowsName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
  return !!parts.length && !normalized.startsWith('/') && !/^[A-Za-z]:/.test(normalized)
    && parts.every(part => !!part && part !== '.' && part !== '..' && !/[<>:"|?*\u0000-\u001f]/.test(part)
      && !/[. ]$/.test(part) && !invalidWindowsName.test(part));
}
async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch { return false; }
}

export class ModelManager {
  catalog: Catalog = { schemaVersion: 2, models: [] };
  installed = new Map<string, InstalledModel>();
  downloads = new Map<string, DownloadState>();
  private active = new Map<string, AbortController>();
  private tasks = new Set<Promise<void>>();
  private bundled = new Map<string, Model>();
  private bundledCatalogPath = '';
  constructor(readonly root: string, readonly catalogPath: string, private emit: (state: DownloadState) => void) {}
  async init(bundledCatalog: string): Promise<void> {
    this.bundledCatalogPath = bundledCatalog;
    const catalog = parseCatalog(await readJson(bundledCatalog));
    this.bundled = new Map(catalog.models.map(model => [fingerprint(model), model]));
    await mkdir(this.root, { recursive: true });
    await this.recoverInterruptedInstall();
    // The public catalog ships with the app and is refreshed by installing an app update.
    await this.replaceCatalog(catalog);
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(entry.name)) continue;
      const directory = join(this.root, entry.name);
      for (const name of await readdir(directory)) {
        if (/^[a-f0-9]{64}\.part$/.test(name)) await rm(join(directory, name), { force: true });
      }
      try {
        const stored = await readJson(join(directory, 'installed.json')) as { model?: unknown; installedAt?: unknown };
        const raw = stored.model as Record<string, unknown> | undefined;
        const schemaVersion = raw && Array.isArray(raw.artifacts) ? 2 : 1;
        const model = parseCatalog({ schemaVersion, models: [stored.model] }).models[0]!;
        if (model.id !== entry.name || typeof stored.installedAt !== 'string' || !await this.validInstall(model)) continue;
        this.installed.set(model.id, { model, installedAt: stored.installedAt });
      } catch { /* Uncommitted or damaged installs do not become selectable. */ }
    }
  }
  private async recoverInterruptedInstall(): Promise<void> {
    const backupRoot = join(this.root, '.backup');
    if (await exists(backupRoot)) {
      for (const entry of await readdir(backupRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(entry.name)) continue;
        const backup = join(backupRoot, entry.name); const current = join(this.root, entry.name);
        if (await exists(current)) await rm(backup, { recursive: true, force: true });
        else await rename(backup, current);
      }
      await rm(backupRoot, { recursive: true, force: true });
    }
    await rm(join(this.root, '.staging'), { recursive: true, force: true });
  }
  private async validInstall(model: Model): Promise<boolean> {
    return this.validInstallAt(join(this.root, model.id), model);
  }
  private async validInstallAt(directory: string, model: Model): Promise<boolean> {
    const entrypoint = await stat(join(directory, ...model.entrypoint.split('/'))).catch(() => null);
    if (!entrypoint?.isFile()) return false;
    for (const artifact of model.artifacts) {
      if (artifact.format !== 'file') continue;
      const file = await stat(join(directory, ...artifact.filename.split('/'))).catch(() => null);
      if (!file?.isFile() || file.size !== artifact.sizeBytes) return false;
    }
    return true;
  }
  filePath(model: Model): string { return join(this.root, model.id, ...model.entrypoint.split('/')); }
  views(supported: (engine: string) => boolean): ModelView[] {
    const all = new Map(this.catalog.models.map(m => [m.id, m]));
    for (const [id, item] of this.installed) if (!all.has(id)) all.set(id, item.model);
    return [...all.values()].map(original => {
      // Supply new presentation metadata for the exact same package without changing installed files.
      const base = this.bundled.get(fingerprint(original));
      const model = base ? { ...original,
        languages: original.languages.some(language => language.startsWith('Многоязычная,')) ? base.languages : original.languages,
        speedScore: original.speedScore ?? base.speedScore, qualityScore: original.qualityScore ?? base.qualityScore,
        recommended: original.recommended ?? base.recommended,
        recommendationReason: original.recommendationReason ?? base.recommendationReason,
        description: original.description ?? base.description,
        family: original.family ?? base.family, quantization: original.quantization ?? base.quantization,
        capabilities: original.capabilities ?? base.capabilities,
      } : original;
      const installed = this.installed.get(model.id) ?? null;
      return { model, installed, supported: supported(model.engine),
        updateAvailable: !!installed && fingerprint(installed.model) !== fingerprint(model) };
    });
  }
  async replaceCatalog(value: unknown): Promise<void> {
    const next = parseCatalog(value);
    await atomicJson(this.catalogPath, next);
    this.catalog = next;
  }
  async refresh(): Promise<void> {
    if (!this.bundledCatalogPath) throw new Error('Встроенный каталог недоступен.');
    await this.replaceCatalog(await readJson(this.bundledCatalogPath));
  }
  start(id: string): Promise<void> {
    if (this.active.size >= 2) throw new Error('Дождитесь завершения одной из двух загрузок.');
    if (this.active.has(id)) throw new Error('Модель уже загружается.');
    const model = this.catalog.models.find(m => m.id === id);
    if (!model) throw new Error('Модель не найдена в каталоге.');
    const controller = new AbortController();
    this.active.set(id, controller);
    this.report({ id, phase: 'downloading', received: 0, total: model.sizeBytes });
    const task = this.install(model, controller);
    this.tasks.add(task);
    void task.finally(() => this.tasks.delete(task));
    return task;
  }
  private report(state: DownloadState): void { this.downloads.set(state.id, state); this.emit(state); }
  private async downloadArtifact(model: Model, artifact: ModelArtifact, index: number, staging: string,
    offset: number, signal: AbortSignal): Promise<void> {
    const target = artifact.format === 'file'
      ? join(staging, ...artifact.filename.split('/'))
      : join(staging, '.archives', `${index}-${basename(artifact.filename)}`);
    const partial = `${target}.part`;
    await mkdir(dirname(target), { recursive: true });
    await downloadVerified({ ...artifact, id: model.id }, partial, signal, state => {
      const completeArtifact = offset + artifact.sizeBytes === model.sizeBytes;
      this.report({ ...state, phase: state.phase === 'verifying' && !completeArtifact ? 'downloading' : state.phase,
        received: offset + state.received, total: model.sizeBytes });
    });
    signal.throwIfAborted();
    await rename(partial, target);
    if (artifact.format === 'tar.gz') {
      await extractTar({ file: target, cwd: staging, gzip: true, strict: true, preservePaths: false,
        filter: (path, entry) => safeArchiveEntry(path) && 'type' in entry && ['File', 'Directory'].includes(entry.type) });
      await rm(target, { force: true });
    }
  }
  private async commit(staging: string, model: Model): Promise<void> {
    const destination = join(this.root, model.id);
    const backupRoot = join(this.root, '.backup'); const backup = join(backupRoot, model.id);
    await mkdir(backupRoot, { recursive: true });
    await rm(backup, { recursive: true, force: true });
    const hadPrevious = await exists(destination);
    if (hadPrevious) await rename(destination, backup);
    try { await rename(staging, destination); }
    catch (error) {
      if (hadPrevious && await exists(backup) && !await exists(destination)) await rename(backup, destination);
      throw error;
    }
    await rm(backup, { recursive: true, force: true });
  }
  private async install(model: Model, controller: AbortController): Promise<void> {
    const staging = join(this.root, '.staging', `${model.id}-${randomUUID()}`);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(3_600_000)]);
    try {
      await mkdir(staging, { recursive: true });
      let offset = 0;
      for (const [index, artifact] of model.artifacts.entries()) {
        await this.downloadArtifact(model, artifact, index, staging, offset, signal);
        offset += artifact.sizeBytes;
      }
      await rm(join(staging, '.archives'), { recursive: true, force: true });
      signal.throwIfAborted();
      if (!await this.validInstallAt(staging, model)) throw new Error('Пакет модели неполный или не содержит точку входа.');
      const meta: InstalledModel = { model, installedAt: new Date().toISOString() };
      await atomicJson(join(staging, 'installed.json'), meta);
      await this.commit(staging, model);
      this.installed.set(model.id, meta);
      this.report({ id: model.id, phase: 'complete', received: model.sizeBytes, total: model.sizeBytes });
    } catch (error) {
      await rm(staging, { recursive: true, force: true }).catch(() => {});
      this.report({ id: model.id, phase: controller.signal.aborted ? 'cancelled' : 'error', received: 0,
        total: model.sizeBytes, error: controller.signal.aborted ? undefined : String(error) });
    } finally { this.active.delete(model.id); }
  }
  cancel(id: string): void { this.active.get(id)?.abort(); }
  async remove(id: string): Promise<void> {
    if (this.active.has(id)) throw new Error('Сначала отмените загрузку.');
    const item = this.installed.get(id);
    if (!item) return;
    // Paths are derived exclusively from validated model IDs and relative catalog paths.
    await rm(join(this.root, item.model.id), { recursive: true, force: true });
    this.installed.delete(id);
    this.downloads.delete(id);
  }
  async shutdown(): Promise<void> {
    for (const controller of this.active.values()) controller.abort();
    await Promise.allSettled([...this.tasks]);
  }
}
