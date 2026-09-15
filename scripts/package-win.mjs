import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stage = await mkdtemp(join(tmpdir(), 'vokeyra-pack-'));
const installer = process.argv.includes('--installer');

try {
  for (const name of ['package-lock.json', 'LICENSE', 'THIRD-PARTY-NOTICES.md']) await cp(join(root, name), join(stage, name));
  for (const name of ['dist', 'resources', 'logo', 'favicon']) await cp(join(root, name), join(stage, name), { recursive: true });
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  manifest.build.directories.output = join(root, 'release');
  await writeFile(join(stage, 'package.json'), JSON.stringify(manifest, null, 2));
  await symlink(join(root, 'node_modules'), join(stage, 'node_modules'), 'junction');

  const cli = join(root, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');
  const args = installer ? [cli, '--win', 'nsis', '--x64'] : [cli, '--win', '--x64', '--dir'];
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, args, { cwd: stage, windowsHide: true, stdio: 'inherit' });
    child.once('error', rejectRun);
    child.once('exit', code => code === 0 ? resolveRun() : rejectRun(new Error(`electron-builder завершился с кодом ${code}.`)));
  });
} finally {
  await rm(stage, { recursive: true, force: true });
}
