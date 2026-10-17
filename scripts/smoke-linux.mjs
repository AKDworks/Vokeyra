import assert from 'node:assert/strict';
import { execFile, spawn, fork } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, mkdtemp, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { build } from 'esbuild';
import { setTimeout as delay } from 'node:timers/promises';

if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('This check needs Linux x64.');
const run = promisify(execFile);
const desktop = resolve('dist/desktop-linux');
const node = join(desktop, 'node');
for (const file of [node, join(desktop, 'whisper/whisper-cli'), resolve('src-tauri/target/release/vokeyra')]) {
  assert.ok((await stat(file)).mode & 0o111, `${file} is not executable`);
  const { stdout } = await run('ldd', [file]);
  assert.ok(!stdout.includes('not found'), `Missing runtime dependency: ${file}\n${stdout}`);
}
await run(node, ['-e', "require('onnxruntime-node');require('sherpa-onnx-node');"], { cwd: desktop });
const temporary = await mkdtemp(resolve('.tmp/linux-smoke-'));
await build({ entryPoints: ['src/main/models.ts', 'src/main/platform/linux-native.ts'], outdir: temporary, outbase: 'src/main',
  outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs' });
const require = createRequire(import.meta.url);
const { LinuxNative } = require(join(temporary, 'platform/linux-native.cjs'));
const { ModelManager } = require(join(temporary, 'models.cjs'));
const models = new ModelManager(join(temporary, 'models'), join(temporary, 'catalog.json'), state => {
  if (state.phase === 'error') console.error(state.error);
});
await models.init(join(desktop, 'models.json'));
const audio = Buffer.alloc(44 + 16000 * 2);
audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(16000, 24); audio.writeUInt32LE(32000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34);
audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);
const wav = join(temporary, 'silence.wav'); await writeFile(wav, audio);
for (const id of ['whisper-tiny-q5-1', 'vosk-small-ru-int8', 'gigaam-v3-e2e-ctc']) {
  await models.start(id);
  const installed = models.installed.get(id);
  assert.ok(installed, `Model download failed: ${id}`);
  if (installed.model.engine === 'whisper.cpp') {
    await run(join(desktop, 'whisper/whisper-cli'), ['-m', models.filePath(installed.model), '-f', wav, '-l', 'en', '-nt', '-ng'], { timeout: 90_000 });
  } else {
    const ctc = installed.model.engine === 'gigaam-v3-e2e-ctc';
    const child = fork(join(desktop, ctc ? 'gigaam-worker.cjs' : 'sherpa-worker.cjs'),
      [installed.model.engine, ctc ? models.filePath(installed.model) : join(models.root, id)],
      { execPath: node, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let diagnostics = ''; child.stderr.on('data', data => { diagnostics = (diagnostics + data).slice(-4000); });
    try {
      await new Promise((resolveInference, reject) => {
        const timer = setTimeout(() => reject(new Error(`Inference timeout: ${id}: ${diagnostics}`)), 90_000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', code => { clearTimeout(timer); reject(new Error(`Engine exited ${code}: ${diagnostics}`)); });
        child.once('message', result => {
          clearTimeout(timer);
          if (result.error) reject(new Error(result.error)); else { assert.equal(typeof result.text, 'string'); resolveInference(); }
        });
        child.send({ id: 1, wavPath: wav });
      });
    } finally { child.kill(); }
  }
  console.log(`Linux native inference passed: ${id}`);
}

// Run a real focused X11 terminal so xdotool must deliver text to another app.
const capture = join(temporary, 'capture.cjs'), result = join(temporary, 'typed.txt');
await writeFile(capture, "const fs=require('node:fs');process.stdin.once('data',data=>{fs.writeFileSync(process.argv[2],data);process.exit();});");
const terminal = spawn('xterm', ['-name', 'VokeyraLinuxSmoke', '-e', node, capture, result], { stdio: 'ignore', env: { ...process.env, LC_ALL: 'C.UTF-8' } });
try {
  const { stdout } = await run('xdotool', ['search', '--sync', '--classname', 'VokeyraLinuxSmoke'], { timeout: 10_000 });
  await run('xdotool', ['windowfocus', '--sync', stdout.trim().split('\n')[0]]);
  const native = new LinuxNative(); await native.start();
  const text = 'Vokeyra Linux input';
  await delay(300);
  await native.command('type', Buffer.from(text).toString('base64'));
  await native.command('key', 'enter');
  for (let attempt = 0; attempt < 40 && !await stat(result).catch(() => null); attempt++) await delay(100);
  assert.equal((await readFile(result, 'utf8')).trim(), text);
} finally { terminal.kill(); }
console.log('Linux runtime, model downloads, native inference, and X11 text insertion passed.');
await writeFile(resolve('.tmp/linux-runtime-report.json'), JSON.stringify({
  modelsPath: models.root, engines: ['whisper-tiny-q5-1', 'vosk-small-ru-int8', 'gigaam-v3-e2e-ctc'],
  nativeInference: true, x11TextInsertion: true,
}, null, 2) + '\n');
// Keep the isolated artifacts in ignored .tmp for diagnostics; never touch user data.
