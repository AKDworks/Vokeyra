import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import {
  LinuxAudioCapture, needsMicrophoneMigration, parsePactlSources, pcm16StereoToMono,
  type CaptureProcess,
} from '../src/main/platform/linux-audio';

class FakeProcess extends EventEmitter implements CaptureProcess {
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  kill = vi.fn(() => {
    if (this.exitCode === null) {
      this.exitCode = 0;
      setImmediate(() => this.emit('exit', 0, null));
    }
    return true;
  });

  exit(code: number | null = 0): void {
    this.exitCode = code;
    this.emit('exit', code, null);
  }
}

function stereo(left: number, right: number, frames: number): Buffer {
  const buffer = Buffer.alloc(frames * 4);
  for (let index = 0; index < frames; index++) {
    buffer.writeInt16LE(Math.round(left * 32767), index * 4);
    buffer.writeInt16LE(Math.round(right * 32767), index * 4 + 2);
  }
  return buffer;
}

const options = {
  microphoneId: 'default',
  inputChannel: 'all' as const,
  onLevel: vi.fn(),
  onLimit: vi.fn(),
};

describe('Linux service-side audio capture', () => {
  it('selects the requested channel and averages without clipping', () => {
    const data = stereo(0.5, 1, 4);
    for (const sample of pcm16StereoToMono(data, 'first')) expect(sample).toBeCloseTo(0.5, 4);
    for (const sample of pcm16StereoToMono(data, 'second')) expect(sample).toBeCloseTo(1, 4);
    for (const sample of pcm16StereoToMono(data, 'all')) expect(sample).toBeCloseTo(0.75, 4);
  });

  it('ignores an incomplete final frame', () => {
    const data = Buffer.concat([stereo(0.25, 0.5, 2), Buffer.from([1, 2, 3])]);
    expect(pcm16StereoToMono(data, 'all')).toHaveLength(2);
  });

  it('parses stable PulseAudio source ids and detects old browser ids', () => {
    const sources = parsePactlSources(`
Source #58
\tState: SUSPENDED
\tName: alsa_input.usb-fifine
\tDescription: fifine Microphone Analog Stereo

Source #60
\tName: alsa_input.pci
\tDescription: Built-in Audio
`);
    expect(sources).toEqual([
      { id: 'alsa_input.usb-fifine', label: 'fifine Microphone Analog Stereo' },
      { id: 'alsa_input.pci', label: 'Built-in Audio' },
    ]);
    expect(needsMicrophoneMigration('a'.repeat(64), sources)).toBe(true);
    expect(needsMicrophoneMigration('alsa_input.pci', sources)).toBe(false);
    expect(needsMicrophoneMigration('default', sources)).toBe(false);
  });

  it('stops an in-flight start without launching a fallback process', async () => {
    const first = new FakeProcess();
    const spawn = vi.fn(() => first);
    const capture = new LinuxAudioCapture(spawn, { probeMs: 40 });
    const onFallback = vi.fn();
    const start = capture.start({ ...options, microphoneId: 'missing-source', onFallback });
    await new Promise(resolve => setTimeout(resolve, 10));
    first.exit(1);
    await new Promise(resolve => setTimeout(resolve, 10));
    const stop = capture.stop('all');
    await expect(start).rejects.toThrow('отменена');
    await stop;
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('allows an immediate next recording after a cancelled start', async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    const spawn = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const cancelled = new LinuxAudioCapture(spawn, { probeMs: 20 });
    const start = cancelled.start({ ...options, microphoneId: 'missing-source' });
    await new Promise(resolve => setTimeout(resolve, 2));
    await cancelled.stop('all');
    await expect(start).rejects.toThrow('отменена');

    const next = new LinuxAudioCapture(spawn, { probeMs: 1 });
    await next.start({ ...options });
    expect(spawn).toHaveBeenCalledTimes(2);
    await next.stop('all');
  });

  it('can cancel while the default-source fallback is starting', async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    const spawn = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const capture = new LinuxAudioCapture(spawn, { probeMs: 30 });
    const onFallback = vi.fn();
    const start = capture.start({ ...options, microphoneId: 'missing-source', onFallback });
    await new Promise(resolve => setTimeout(resolve, 5));
    first.exit(1);
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledTimes(2);
    const stop = capture.stop('all');
    await expect(start).rejects.toThrow('отменена');
    await stop;
    expect(second.kill).toHaveBeenCalled();
  });

  it('falls back to the default source and tells the caller when the selected one is unavailable', async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    const spawn = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const capture = new LinuxAudioCapture(spawn, { probeMs: 10 });
    const onFallback = vi.fn();
    const start = capture.start({ ...options, microphoneId: 'missing-source', onFallback });
    await new Promise(resolve => setTimeout(resolve, 2));
    first.exit(1);
    await start;
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls.map(call => call[0])).toHaveLength(2);
    expect(spawn.mock.calls[1]![0].join(' ')).toContain('@DEFAULT_SOURCE@');
    const wav = await capture.stop('all');
    expect(wav.byteLength).toBeGreaterThanOrEqual(44);
  });

  it('does not hide an unavailable selected source when fallback is disabled', async () => {
    const first = new FakeProcess();
    const capture = new LinuxAudioCapture(() => first, { probeMs: 10 });
    const start = capture.start({ ...options, microphoneId: 'missing-source', allowFallback: false });
    first.exit(1);
    await expect(start).rejects.toThrow('неожиданно');
  });

  it('trims PCM at the exact duration limit and notifies only once', async () => {
    const process = new FakeProcess();
    const spawn = vi.fn(() => process);
    const capture = new LinuxAudioCapture(spawn, { probeMs: 1, maxSeconds: 0.01 });
    const onLimit = vi.fn();
    await capture.start({ ...options, onLimit });
    process.stdout.write(stereo(0.4, 0.4, 100));
    process.stdout.write(stereo(0.4, 0.4, 100));
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(onLimit).toHaveBeenCalledTimes(1);
    expect(capture.limited).toBe(true);
    expect(process.kill).toHaveBeenCalled();
    process.exit(0);
    const wav = await capture.stop('all');
    // 0.01 s at 16 kHz = 160 mono frames; never throw on a slightly long buffer.
    expect(wav.byteLength).toBe(44 + 160 * 2);
  });

  it('stops exactly at the frame boundary without waiting for extra data', async () => {
    const process = new FakeProcess();
    const capture = new LinuxAudioCapture(() => process, { probeMs: 1, maxSeconds: 0.01 });
    const onLimit = vi.fn();
    await capture.start({ ...options, onLimit });
    process.stdout.write(stereo(0.2, 0.2, 160));
    await new Promise(resolve => setTimeout(resolve, 2));
    expect(onLimit).toHaveBeenCalledTimes(1);
    process.stdout.write(stereo(0.9, 0.9, 10));
    process.exit(0);
    const wav = await capture.stop('all');
    expect(wav.byteLength).toBe(44 + 160 * 2);
  });

  it('reports a process that dies after a successful start', async () => {
    const process = new FakeProcess();
    const spawn = vi.fn(() => process);
    const capture = new LinuxAudioCapture(spawn, { probeMs: 1 });
    const onError = vi.fn();
    await capture.start({ ...options, onError });
    process.stdout.write(stereo(0.3, 0.3, 20));
    process.exit(1);
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(capture.error?.message).toContain('неожиданно');
    process.emit('exit', 1, null);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('treats exit code zero without stop as an unexpected end', async () => {
    const process = new FakeProcess();
    const capture = new LinuxAudioCapture(() => process, { probeMs: 1 });
    const onError = vi.fn();
    await capture.start({ ...options, onError });
    process.exit(0);
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(capture.error).toBeDefined();
  });

  it('does not report an expected stop as a capture error', async () => {
    const process = new FakeProcess();
    const capture = new LinuxAudioCapture(() => process, { probeMs: 1 });
    const onError = vi.fn();
    await capture.start({ ...options, onError });
    const wav = await capture.stop('all');
    expect(onError).not.toHaveBeenCalled();
    expect(wav.byteLength).toBeGreaterThanOrEqual(44);
  });

  it('does not spawn a fallback after stop during a spawn error', async () => {
    const first = new FakeProcess();
    const spawn = vi.fn(() => first);
    const capture = new LinuxAudioCapture(spawn, { probeMs: 40 });
    const start = capture.start({ ...options, microphoneId: 'missing-source' });
    await new Promise(resolve => setTimeout(resolve, 5));
    first.emit('error', new Error('spawn parec ENOENT'));
    const stop = capture.stop('all');
    await expect(start).rejects.toThrow('отменена');
    await stop;
    expect(spawn).toHaveBeenCalledTimes(1);
  });
});
