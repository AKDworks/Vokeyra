import { describe, expect, it, vi } from 'vitest';
import { checkForUpdates, compareVersions } from '../src/main/update';

describe('application updates', () => {
  it('compares stable semantic versions numerically', () => {
    expect(compareVersions('0.1.10', '0.1.9')).toBe(1);
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.2.0', '1.0.0')).toBe(-1);
  });

  it('reports a newer GitHub release', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ tag_name: 'v0.1.2' })));
    await expect(checkForUpdates('0.1.1', fetcher)).resolves.toEqual({
      currentVersion: '0.1.1', latestVersion: '0.1.2', updateAvailable: true,
    });
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/releases/latest'), expect.objectContaining({ redirect: 'error' }));
  });

  it('does not offer an older or equal release', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ tag_name: 'v0.1.0' })));
    await expect(checkForUpdates('0.1.1', fetcher)).resolves.toMatchObject({ updateAvailable: false });
  });

  it('rejects malformed and failed responses', async () => {
    await expect(checkForUpdates('0.1.1', vi.fn().mockResolvedValue(new Response('{}')))).rejects.toThrow('некорректный ответ');
    await expect(checkForUpdates('0.1.1', vi.fn().mockResolvedValue(new Response(null, { status: 503 })))).rejects.toThrow('HTTP 503');
  });
});
