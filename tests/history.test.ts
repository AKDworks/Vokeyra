import { expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HistoryStore } from '../src/main/history';
it('persists text, serializes concurrent updates, restores and deletes history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vokeyra-history-'));
  try {
    const path = join(root, 'history.json');
    const history = new HistoryStore(path); await history.init();
    await Promise.all([history.add('Первый текст', 'Whisper Tiny'), history.add('Второй текст', 'Whisper Base')]);
    const restored = new HistoryStore(path); await restored.init();
    expect(restored.entries.map(entry => entry.text)).toEqual(['Второй текст', 'Первый текст']);
    await restored.remove(restored.entries[0]!.id);
    expect(restored.entries).toHaveLength(1);
    await restored.clear();
    const empty = new HistoryStore(path); await empty.init(); expect(empty.entries).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
