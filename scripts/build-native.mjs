import { spawn } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export async function buildNative() {
  if (process.platform !== 'win32') return;
  const source = resolve('native/windows/DesktopHelper.cs');
  const output = resolve('dist/native/Vokeyra.Desktop.exe');
  if (await stat(output).then(async file => file.mtimeMs >= (await stat(source)).mtimeMs).catch(() => false)) return;
  await mkdir('dist/native', { recursive: true });
  const compiler = join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  await new Promise((resolve, reject) => {
    const child = spawn(compiler, ['/nologo', '/optimize+', '/target:exe', `/out:${output}`, source], { windowsHide: true, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Native helper compilation failed: ${code}`)));
  });
}
