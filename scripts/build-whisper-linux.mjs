import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat, readdir, cp, chmod } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { extract } from 'tar';

// Pin upstream source and verify the archive before invoking its build scripts.
const version = '1.8.3';
const sha256 = '870ba21409cdf66697dc4db15ebdb13bc67037d76c7cc63756c81471d8f1731a';
const cache = resolve('.tmp', `whisper-linux-${version}`);
const source = join(cache, 'source'), build = join(cache, 'build'), bin = join(build, 'bin');
const marker = `${sha256}:cpu-dispatch-v1`;
async function run(file, args) {
  await new Promise((resolveRun, reject) => {
    const child = spawn(file, args, { stdio: 'inherit', shell: false });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolveRun() : reject(new Error(`${file} exited ${code}`)));
  });
}
export async function buildWhisperLinux(destination) {
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Build the Linux x64 package on an x64 Linux host.');
  const ready = await readFile(join(cache, 'built.txt'), 'utf8').catch(() => '');
  if (ready !== marker || !await stat(join(bin, 'whisper-cli')).then(file => file.isFile()).catch(() => false)) {
    await mkdir(source, { recursive: true });
    const archive = join(cache, 'source.tar.gz');
    let data = await readFile(archive).catch(() => null);
    if (!data || createHash('sha256').update(data).digest('hex') !== sha256) {
      const response = await fetch(`https://codeload.github.com/ggml-org/whisper.cpp/tar.gz/refs/tags/v${version}`, { signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error(`whisper.cpp download: HTTP ${response.status}`);
      data = Buffer.from(await response.arrayBuffer());
      if (createHash('sha256').update(data).digest('hex') !== sha256) throw new Error('whisper.cpp source SHA-256 mismatch.');
      await writeFile(archive, data);
    }
    await extract({ file: archive, cwd: source, strip: 1, strict: true, preservePaths: false });
    await run('cmake', ['-S', source, '-B', build, '-DCMAKE_BUILD_TYPE=Release',
      `-DCMAKE_RUNTIME_OUTPUT_DIRECTORY=${bin}`, `-DCMAKE_LIBRARY_OUTPUT_DIRECTORY=${bin}`,
      '-DCMAKE_INSTALL_RPATH=$ORIGIN', '-DCMAKE_BUILD_WITH_INSTALL_RPATH=ON',
      '-DGGML_NATIVE=OFF', '-DGGML_BACKEND_DL=ON', '-DGGML_CPU_ALL_VARIANTS=ON',
      '-DWHISPER_BUILD_TESTS=OFF', '-DWHISPER_CURL=OFF', '-DWHISPER_SDL2=OFF']);
    await run('cmake', ['--build', build, '--config', 'Release', '--parallel', '4']);
    await writeFile(join(cache, 'built.txt'), marker);
  }
  await mkdir(destination, { recursive: true });
  const libraries = (await readdir(bin)).filter(name => /^lib(?:whisper|ggml).*\.so(?:\.[0-9.]+)?$/.test(name));
  if (!libraries.length) throw new Error('whisper.cpp shared libraries were not produced.');
  for (const name of ['whisper-cli', ...libraries]) await cp(join(bin, name), join(destination, name), { dereference: true });
  await chmod(join(destination, 'whisper-cli'), 0o755);
  await cp(join(source, 'LICENSE'), join(destination, 'LICENSE'));
}
