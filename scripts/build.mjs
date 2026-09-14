import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import { buildNative } from './build-native.mjs';
export const entries = [
  { entryPoints: ['src/main/engines/gigaam-worker.ts'], outfile: 'dist/main/gigaam-worker.cjs', platform: 'node' },
  { entryPoints: ['src/main/engines/sherpa-worker.ts'], outfile: 'dist/main/sherpa-worker.cjs', platform: 'node' },
  { entryPoints: ['src/main/index.ts'], outfile: 'dist/main/index.cjs', platform: 'node' },
  { entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload/index.cjs', platform: 'node' },
  { entryPoints: ['src/preload/overlay.ts'], outfile: 'dist/preload/overlay.cjs', platform: 'node' },
];
export const common = { bundle: true, format: 'cjs', target: 'node22', external: ['electron', 'onnxruntime-node', 'sherpa-onnx-node'], sourcemap: true };
if (process.argv[1]?.endsWith('build.mjs')) {
  await buildNative();
  await Promise.all(entries.map(entry => build({ ...common, ...entry })));
  await viteBuild();
}
