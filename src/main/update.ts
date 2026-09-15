export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
}

const latestReleaseApi = 'https://api.github.com/repos/AKDworks/Vokeyra/releases/latest';

function versionParts(value: string): [number, number, number] {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
  if (!match) throw new Error('Сервис обновлений вернул некорректную версию.');
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareVersions(left: string, right: string): number {
  const a = versionParts(left); const b = versionParts(right);
  for (let index = 0; index < a.length; index++) {
    if (a[index]! !== b[index]!) return a[index]! > b[index]! ? 1 : -1;
  }
  return 0;
}

export async function checkForUpdates(currentVersion: string, fetcher: typeof fetch = fetch): Promise<UpdateCheckResult> {
  versionParts(currentVersion);
  let response: Response;
  try {
    response = await fetcher(latestReleaseApi, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Vokeyra/${currentVersion}` },
      redirect: 'error', signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error('Не удалось проверить обновления. Проверьте интернет и повторите попытку.');
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Не удалось проверить обновления: HTTP ${response.status}.`);
  }
  const value = await response.json().catch(() => null) as { tag_name?: unknown } | null;
  if (!value || typeof value.tag_name !== 'string') throw new Error('Сервис обновлений вернул некорректный ответ.');
  const latestVersion = value.tag_name.replace(/^v/, '');
  versionParts(latestVersion);
  return { currentVersion, latestVersion, updateAvailable: compareVersions(latestVersion, currentVersion) > 0 };
}

export const latestReleaseUrl = 'https://github.com/AKDworks/Vokeyra/releases/latest';
