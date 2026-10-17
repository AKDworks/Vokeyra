import { spawn, fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import assert from 'node:assert/strict';

const desktop = resolve(process.platform === 'linux' ? 'dist/desktop-linux' : 'dist/desktop');
const require = createRequire(join(desktop, 'service.cjs'));
assert.ok(require('onnxruntime-node').InferenceSession);
assert.ok(require('sherpa-onnx-node').OfflineRecognizer);
const modelRoot = process.argv[2] || join(process.env.APPDATA || '', 'Vokeyra/models');
const directory = await mkdtemp(resolve('.tmp/tauri-engines-'));
const audio = Buffer.alloc(44 + 16000 * 2);
audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(16000, 24); audio.writeUInt32LE(32000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34);
audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);
const wavPath = join(directory, 'silence.wav'); await writeFile(wavPath, audio);
let checked = 0;
try {
  for (const id of ['gigaam-v3-e2e-rnnt', 'gigaam-v3-e2e-ctc', 'gigaam-multilingual-ctc', 'moonshine-tiny-en-int8', 'parakeet-tdt-0-6b-v3-int8',
    'moonshine-base-en-int8', 'sensevoice-small-int8', 'vosk-small-ru-int8', 'zipformer-gigaspeech-en-int8']) {
    const folder = join(modelRoot, id);
    const metadata = await readFile(join(folder, 'installed.json'), 'utf8').then(JSON.parse).catch(() => null);
    if (!metadata) continue;
    const ctc = id === 'gigaam-v3-e2e-ctc' || id === 'gigaam-multilingual-ctc';
    const argument = ctc ? join(folder, metadata.model.entrypoint) : folder;
    const child = fork(join(desktop, ctc ? 'gigaam-worker.cjs' : 'sherpa-worker.cjs'), [id, argument], {
      execPath: join(desktop, process.platform === 'win32' ? 'node.exe' : 'node'), stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true,
    });
    let errors = ''; child.stderr.on('data', value => { errors = (errors + value).slice(-3000); });
    try {
      const result = await new Promise((resolveResult, reject) => {
        const timer = setTimeout(() => reject(new Error(`Engine timeout ${id}: ${errors}`)), 90_000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', code => { clearTimeout(timer); reject(new Error(`Engine exited ${code}: ${errors}`)); });
        child.once('message', message => { clearTimeout(timer); message.error ? reject(new Error(message.error)) : resolveResult(message.text); });
        child.send({ id: 1, wavPath });
      });
      assert.equal(typeof result, 'string'); checked++;
      console.log(`Native inference passed: ${id}.`);
    } finally { child.kill(); }
  }
  assert.ok(checked > 0, 'No installed model available for the native inference check.');
  console.log('ONNX and sherpa libraries load successfully in the bundled Node runtime.');
} finally { await rm(directory, { recursive: true, force: true }); }
