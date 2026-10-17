import { spawn } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function buildNative() {
  if (process.platform !== 'win32') return;
  const source = resolve('native/windows/DesktopHelper.cs');
  const output = resolve('dist/native/Vokeyra.Desktop.exe');
  const { version } = JSON.parse(await readFile('package.json', 'utf8'));
  const release = version.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!release || release.slice(1).some(part => Number(part) > 65534)) throw new Error('Invalid native helper version.');
  const metadata = resolve('.tmp/native-build');
  const stamp = join(metadata, 'version.txt');
  const sources = await Promise.all([source, fileURLToPath(import.meta.url)].map(path => stat(path)));
  const currentVersion = await readFile(stamp, 'utf8').catch(() => '');
  if (currentVersion === version && await stat(output).then(file => sources.every(source => file.mtimeMs >= source.mtimeMs)).catch(() => false)) return;
  await mkdir('dist/native', { recursive: true });
  await mkdir(metadata, { recursive: true });
  const info = join(metadata, 'AssemblyInfo.cs');
  const fileVersion = release.slice(1).join('.') + '.0';
  await writeFile(info, `using System.Reflection;\n[assembly: AssemblyTitle("Vokeyra Desktop")]\n[assembly: AssemblyProduct("Vokeyra")]\n[assembly: AssemblyCompany("AKDworks")]\n[assembly: AssemblyVersion("${fileVersion}")]\n[assembly: AssemblyFileVersion("${fileVersion}")]\n[assembly: AssemblyInformationalVersion("${version}")]\n`);
  const compiler = join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  await new Promise((resolve, reject) => {
    const child = spawn(compiler, ['/nologo', '/optimize+', '/target:exe', `/out:${output}`, source, info], { windowsHide: true, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Native helper compilation failed: ${code}`)));
  });
  await writeFile(stamp, version);
}
