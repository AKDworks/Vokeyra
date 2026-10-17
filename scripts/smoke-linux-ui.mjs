import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, writeFile, cp, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('This check needs Linux x64.');
const run = promisify(execFile);
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const runtime = JSON.parse(await readFile('.tmp/linux-runtime-report.json', 'utf8'));
const temporary = await mkdtemp(resolve('.tmp/linux-ui-'));
const reports = resolve('.tmp/linux-ui-reports');
await mkdir(reports, { recursive: true });
const installed = '/usr/bin/vokeyra';
const appimages = (await readdir('src-tauri/target/release/bundle/appimage')).filter(name => name.endsWith('.AppImage') && name.includes(version));
assert.equal(appimages.length, 1, 'Expected one AppImage for this version.');
const applications = [
  ['deb', installed],
  ['appimage', resolve('src-tauri/target/release/bundle/appimage', appimages[0])],
];
const speech = join(temporary, 'speech.wav');
await run('espeak', ['-v', 'en-us', '-s', '140', '-w', speech, 'Hello world. This is a test of local speech recognition.']);
await run('pulseaudio', ['--start', '--exit-idle-time=-1', `--log-target=file:${join(temporary, 'pulseaudio.log')}`]);
const modules = [];
let player;
let playing = true;
const result = { version, packages: [], limitations: ['Virtual X11 display and PulseAudio microphone; no physical microphone, native Wayland, or installed update test.'] };
try {
  modules.push((await run('pactl', ['load-module', 'module-null-sink', 'sink_name=VokeyraTestOutput', 'rate=48000', 'channels=2'])).stdout.trim());
  modules.push((await run('pactl', ['load-module', 'module-remap-source', 'master=VokeyraTestOutput.monitor', 'source_name=VokeyraTestMic', 'source_properties=device.description=VokeyraTestMicrophone'])).stdout.trim());
  await run('pactl', ['set-default-source', 'VokeyraTestMic']);
  await run('pactl', ['set-default-sink', 'VokeyraTestOutput']);
  const playback = (async () => {
    while (playing) {
      await new Promise((done, reject) => {
        player = spawn('paplay', ['--device=VokeyraTestOutput', speech], { stdio: 'ignore' });
        player.once('error', reject); player.once('exit', code => code === 0 || !playing ? done() : reject(new Error(`Synthetic speech playback exited ${code}`)));
      });
    }
  })();
  // Keep any asynchronous failure observable until the finally block joins it.
  let playbackError;
  playback.catch(error => { playbackError = error; });
  try {
    for (const [format, application] of applications) {
      const profile = join(temporary, format);
      await mkdir(profile, { recursive: true });
      await cp(join(runtime.modelsPath, 'whisper-tiny-q5-1'), join(profile, 'models/whisper-tiny-q5-1'), { recursive: true });
      await writeFile(join(profile, 'settings.json'), JSON.stringify({
        launchAtStartup: false, showTrayIcon: false, windowSize: 'compact', appLanguage: 'en',
        pasteMethod: 'none', clipboardHandling: 'keep', selectedModelId: 'whisper-tiny-q5-1', language: 'en',
        hotkey: 'F9', pushToTalk: false, muteWhileRecording: false, audioFeedback: false,
      }));
      const port = await new Promise(done => {
        const server = createServer();
        server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => done(port)); });
      });
      // WebKitWebDriver is the same native driver used by tauri-driver on Linux.
      // No testing plugin, mocked microphone, or IPC replacement is added to the app.
      const driver = spawn('WebKitWebDriver', [`--port=${port}`, '--host=127.0.0.1'], {
        env: { ...process.env, TAURI_AUTOMATION: 'true', TAURI_WEBVIEW_AUTOMATION: 'true',
          VOKEYRA_TEST_DATA: profile, XDG_CONFIG_HOME: join(profile, 'config'), XDG_DATA_HOME: join(profile, 'data'), XDG_CACHE_HOME: join(profile, 'cache'),
          XDG_SESSION_TYPE: 'x11', GDK_BACKEND: 'x11', PULSE_SOURCE: 'VokeyraTestMic', PULSE_SINK: 'VokeyraTestOutput', APPIMAGE_EXTRACT_AND_RUN: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let diagnostics = '', session;
      for (const output of [driver.stdout, driver.stderr]) output.on('data', data => { diagnostics = (diagnostics + data).slice(-24000); });
      async function request(method, path, body, timeout = 90000) {
        const response = await fetch(`http://127.0.0.1:${port}${path}`, {
          method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout),
        });
        const payload = await response.json();
        if (!response.ok || payload.value?.error) throw new Error(`WebDriver ${path}: ${JSON.stringify(payload.value)}`);
        return payload.value;
      }
      const execute = async (fn, ...args) => {
        const response = await request('POST', `/session/${session}/execute/async`, {
          script: `const args = Array.from(arguments); const done = args.pop(); Promise.resolve().then(() => (${fn.toString()})(...args)).then(value => done({ ok: true, value: value === undefined ? null : value }), error => done({ ok: false, error: String(error), stack: error.stack }));`, args,
        });
        if (!response.ok) throw new Error(`${response.error}\n${response.stack ?? ''}`);
        return response.value;
      };
      async function until(fn, description, timeout = 15000) {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
          if (playbackError) throw playbackError;
          const value = await fn(); if (value) return value;
          await delay(200);
        }
        throw new Error(`Timed out: ${description}`);
      }
      try {
        await until(async () => {
          if (driver.exitCode !== null) throw new Error(`WebKitWebDriver exited: ${diagnostics}`);
          return fetch(`http://127.0.0.1:${port}/status`).then(response => response.ok).catch(() => false);
        }, 'WebKitWebDriver startup');
        session = (await request('POST', '/session', { capabilities: { alwaysMatch: { 'webkitgtk:browserOptions': { binary: application, args: [] } } } })).sessionId;
        await request('POST', `/session/${session}/timeouts`, { script: 90000 });
        const windows = await request('GET', `/session/${session}/window/handles`);
        let main;
        for (const handle of windows) {
          await request('POST', `/session/${session}/window`, { handle });
          if (await execute(() => !!document.getElementById('footer-version'))) { main = handle; break; }
        }
        assert.ok(main, 'Main application WebView must be available.');
        await until(() => execute(() => !document.body.classList.contains('booting')), 'interface initialization', 30000);
        const snapshot = await execute(() => window.vokeyra.snapshot());
        assert.equal(snapshot.appVersion, version); assert.equal(snapshot.models.length, 19);
        assert.equal(snapshot.desktop.platform, 'linux'); assert.equal(snapshot.desktop.session, 'x11');
        assert.equal(snapshot.hotkeyRegistered, true); assert.equal(snapshot.engineReady, true);
        assert.equal(await execute(() => document.getElementById('footer-version').textContent), `Vokeyra ${version}`);
        const input = await execute(async () => {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          const track = stream.getAudioTracks()[0]; const result = { label: track.label, readyState: track.readyState, secure: window.isSecureContext, audioWorklet: !!window.AudioWorkletNode };
          stream.getTracks().forEach(track => track.stop()); return result;
        });
        assert.equal(input.readyState, 'live'); assert.equal(input.secure, true); assert.equal(input.audioWorklet, true);
        assert.match(input.label, /Vokeyra/i, 'Use the actual PulseAudio test microphone, not a WebKit mock.');
        await execute(() => document.getElementById('record').click());
        await until(() => execute(() => /Recording|Идёт запись/.test(document.getElementById('record-status').textContent)), 'recording start');
        await delay(6500);
        assert.match(await execute(() => document.getElementById('record-status').textContent), /Recording|Идёт запись/);
        await execute(() => document.getElementById('record').click());
        const recorded = await until(async () => {
          const state = await execute(() => window.vokeyra.snapshot());
          const entry = state.history[0];
          if (entry?.status === 'failed') throw new Error(`Transcription failed: ${JSON.stringify(entry)}`);
          return !state.busy && entry?.status === 'complete' ? entry : null;
        }, 'Whisper transcription', 120000);
        assert.match(recorded.text, /hello|world|test|speech|recognition/i, 'Recognize words from the synthetic speech.');
        const samples = await execute(async id => {
          const bytes = await window.vokeyra.historyAudio(id); const view = new DataView(bytes);
          let sum = 0; for (let offset = 44; offset + 1 < bytes.byteLength; offset += 2) sum += (view.getInt16(offset, true) / 32768) ** 2;
          return { bytes: bytes.byteLength, rms: Math.sqrt(sum / ((bytes.byteLength - 44) / 2)) };
        }, recorded.id);
        assert.ok(samples.bytes > 16000 * 2, 'History must contain captured audio.');
        assert.ok(samples.rms > .001, `Captured microphone audio must not be silent: ${samples.rms}`);
        await execute(() => window.vokeyra.saveSettings({ modelUnloadDelay: '2m' }));
        assert.equal(JSON.parse(await readFile(join(profile, 'settings.json'), 'utf8')).modelUnloadDelay, '2m');
        await writeFile(join(reports, `${format}.png`), Buffer.from(await request('GET', `/session/${session}/screenshot`), 'base64'));
        result.packages.push({ format, application, microphone: input, recording: samples, transcript: recorded.text, settingsSaved: true, versionVerified: true });
        console.log(`${format}: installed application → PulseAudio microphone → AudioWorklet → Whisper → history passed: ${recorded.text}`);
      } catch (error) {
        if (session) {
          await writeFile(join(reports, `${format}-failure.png`), Buffer.from(await request('GET', `/session/${session}/screenshot`).catch(() => ''), 'base64'));
          console.error(await execute(() => ({ status: document.getElementById('record-status')?.textContent, notice: document.getElementById('notice-text')?.textContent, url: location.href })).catch(() => null));
        }
        throw error;
      } finally {
        if (session) await request('DELETE', `/session/${session}`).catch(() => {});
        driver.kill();
        await writeFile(join(reports, `${format}-driver.log`), diagnostics);
      }
    }
  } finally { playing = false; player?.kill(); await playback; }
} finally {
  for (const module of modules.reverse()) await run('pactl', ['unload-module', module]).catch(() => {});
  await writeFile(join(reports, 'results.json'), JSON.stringify(result, null, 2) + '\n');
}
assert.equal(result.packages.length, 2);
console.log('Linux .deb and AppImage UI/virtual-microphone checks passed. Physical devices and native Wayland remain unverified.');
