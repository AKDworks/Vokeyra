import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { atomicJson, readJson } from './storage';
import type { HistoryEntry } from '../shared/contracts';

export class HistoryStore {
  entries: HistoryEntry[] = [];
  private pending = Promise.resolve();
  readonly recordingsPath: string;
  constructor(private path: string) { this.recordingsPath = join(dirname(path), 'recordings'); }
  async init(): Promise<void> {
    await mkdir(this.recordingsPath, { recursive: true });
    try {
      const data = await readJson(this.path);
      if (Array.isArray(data)) this.entries = data.filter((v): v is HistoryEntry =>
        v && typeof v.id === 'string' && typeof v.text === 'string' && v.text.length <= 100_000 &&
        typeof v.modelName === 'string' && typeof v.createdAt === 'string' && Number.isFinite(Date.parse(v.createdAt)));
      for (const entry of this.entries) {
        if (entry.status === 'pending') entry.status = 'failed';
        entry.hasAudio = !!entry.hasAudio && await stat(this.audioPath(entry.id)).then(s => s.isFile(), () => false);
      }
    } catch { /* History failure must not block dictation. */ }
  }
  private change(transform: (entries: HistoryEntry[]) => HistoryEntry[]): Promise<void> {
    const task = this.pending.then(async () => {
      const next = transform(this.entries);
      await atomicJson(this.path, next);
      this.entries = next;
    });
    this.pending = task.catch(() => {});
    return task;
  }
  add(text: string, modelName: string): Promise<void> {
    return this.change(entries => [{ id: randomUUID(), text: text.slice(0, 100_000), modelName, createdAt: new Date().toISOString() }, ...entries]);
  }
  private audioPath(id: string): string {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Некорректная запись.');
    return join(this.recordingsPath, `${id}.wav`);
  }
  async addRecording(wav: ArrayBuffer, modelName: string): Promise<string> {
    const id = randomUUID();
    await writeFile(this.audioPath(id), Buffer.from(wav));
    try {
      await this.change(entries => [{ id, text: '', modelName, createdAt: new Date().toISOString(),
        hasAudio: true, duration: (wav.byteLength - 44) / 32000, favorite: false, status: 'pending' }, ...entries]);
    } catch (error) { await rm(this.audioPath(id), { force: true }); throw error; }
    return id;
  }
  update(id: string, patch: Partial<Pick<HistoryEntry, 'text' | 'modelName' | 'status'>>): Promise<void> {
    return this.change(entries => entries.map(entry => entry.id === id ? { ...entry, ...patch } : entry));
  }
  favorite(id: string): Promise<void> {
    return this.change(entries => entries.map(entry => entry.id === id ? { ...entry, favorite: !entry.favorite } : entry));
  }
  async audio(id: string): Promise<ArrayBuffer> {
    if (!this.entries.some(entry => entry.id === id && entry.hasAudio)) throw new Error('Аудио недоступно.');
    const data = await readFile(this.audioPath(id));
    return Uint8Array.from(data).buffer;
  }
  async remove(id: string): Promise<void> {
    const entry = this.entries.find(entry => entry.id === id);
    if (!entry) return;
    if (entry.hasAudio) await rm(this.audioPath(id), { force: true });
    await this.change(entries => entries.filter(entry => entry.id !== id));
  }
  async clear(): Promise<void> {
    for (const entry of [...this.entries]) await this.remove(entry.id);
  }
  async applyPolicy(limit: number, retention: 'never' | 'limit' | '3d' | '2w' | '3m'): Promise<void> {
    if (retention === 'never') return;
    let removed: HistoryEntry[];
    if (retention === 'limit') {
      const favorites = this.entries.filter(entry => entry.favorite);
      const ordinary = this.entries.filter(entry => !entry.favorite);
      const keep = new Set([...favorites, ...ordinary.slice(0, Math.max(0, limit - favorites.length))].map(entry => entry.id));
      removed = this.entries.filter(entry => !keep.has(entry.id));
    } else {
      const age = { '3d': 3 * 86_400_000, '2w': 14 * 86_400_000, '3m': 90 * 86_400_000 }[retention];
      const cutoff = Date.now() - age;
      removed = this.entries.filter(entry => !entry.favorite && Date.parse(entry.createdAt) < cutoff);
    }
    if (!removed.length) return;
    const ids = new Set(removed.map(entry => entry.id));
    await this.change(entries => entries.filter(entry => !ids.has(entry.id)));
    await Promise.all(removed.filter(entry => entry.hasAudio).map(entry => rm(this.audioPath(entry.id), { force: true })));
  }
}
