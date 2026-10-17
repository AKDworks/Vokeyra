import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import { cp, mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { basename, join, resolve, dirname, relative } from 'node:path';
import { buildNative } from './build-native.mjs';
import { buildWhisperLinux } from './build-whisper-linux.mjs';

export async function buildDesktop({ frontend = true } = {}) {
  const output = resolve(process.platform === 'linux' ? 'dist/desktop-linux' : 'dist/desktop');
  await mkdir(output, { recursive: true });
  await buildNative();
  const common = { bundle: true, format: 'cjs', target: 'node24', platform: 'node', sourcemap: false,
    external: ['onnxruntime-node', 'sherpa-onnx-node'], logLevel: 'info' };
  await Promise.all([
    ['service', 'src/main/service.ts'], ['gigaam-worker', 'src/main/engines/gigaam-worker.ts'], ['sherpa-worker', 'src/main/engines/sherpa-worker.ts'],
  ].map(([name, entry]) => build({ ...common, entryPoints: [entry], outfile: join(output, `${name}.cjs`) })));
  await writeFile(join(output, 'package.json'), JSON.stringify({ type: 'commonjs', private: true }));
  // Ship a private runtime so end users never need to install Node or Rust.
  const nodeTarget = join(output, process.platform === 'win32' ? 'node.exe' : 'node');
  if (!await stat(nodeTarget).then(async value => value.size === (await stat(process.execPath)).size).catch(() => false)) await cp(process.execPath, nodeTarget);
  await cp('resources/Node-LICENSE.txt', join(output, 'Node-LICENSE.txt'));
  const sherpaPlatform = `sherpa-onnx-${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`;
  for (const name of ['onnxruntime-node', 'onnxruntime-common', 'sherpa-onnx-node', sherpaPlatform]) {
    const source = resolve('node_modules', name);
    await cp(source, join(output, 'node_modules', name), { recursive: true, filter: path => {
      const relative = path.slice(source.length).replaceAll('\\', '/');
      if (/\.(map|ts)$/.test(path)) return false;
      const native = relative.match(/^\/bin\/napi-v\d+\/(\w+)(?:\/(\w+))?/);
      return !native || (native[1] === process.platform && (!native[2] || native[2] === process.arch));
    } });
  }
  await cp('resources/models.json', join(output, 'models.json'));
  await mkdir(join(output, 'licenses'), { recursive: true });
  for (const path of ['LICENSE', 'THIRD-PARTY-NOTICES.md', ...['GigaAM', 'ONNX-Runtime', 'Whisper.cpp', 'Sherpa-ONNX', 'Tauri', 'SenseVoice-Model', 'Distil-Whisper'].map(name => `resources/${name}-LICENSE.txt`)]) {
    await cp(path, join(output, 'licenses', basename(path)));
  }
  await cp(join(output, 'Node-LICENSE.txt'), join(output, 'licenses', 'Node-LICENSE.txt'));
  if (process.platform === 'win32') {
    const native = resolve('dist/native');
    await cp(native, join(output, 'native'), { recursive: true, filter: async path => {
      if ((await stat(path)).isDirectory()) return true;
      // Avoid replacing an identical helper executable Windows may still hold open.
      const target = join(output, 'native', relative(native, path));
      const existing = await readFile(target).catch(() => null);
      return !existing || !existing.equals(await readFile(path));
    } });
    const whisper = resolve('resources/whisper');
    await cp(whisper, join(output, 'whisper'), { recursive: true,
      filter: path => path === whisper || /(?:whisper-cli\.exe|whisper\.dll|ggml(?:-base|-cpu-[^/\\]+)?\.dll)$/.test(path) });
  }
  if (process.platform === 'linux') await buildWhisperLinux(join(output, 'whisper'));
  if (frontend) await viteBuild();
}

if (process.argv[1]?.endsWith('build-tauri.mjs')) await buildDesktop({ frontend: !process.argv.includes('--backend-only') });
