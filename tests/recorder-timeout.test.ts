import { afterEach, describe, expect, it, vi } from 'vitest';
import { MicrophoneRecorder } from '../src/renderer/recorder';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function fakeStream() {
  const track = { stop: vi.fn() };
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
    getVideoTracks: () => [],
  };
  return { track, stream: stream as unknown as MediaStream };
}

afterEach(() => vi.unstubAllGlobals());

describe('WebView microphone lifecycle', () => {
  it('stops a stream that resolves after the getUserMedia timeout', async () => {
    const { track, stream } = fakeStream();
    const getUserMedia = vi.fn(() => new Promise<MediaStream>(resolve => setTimeout(() => resolve(stream), 40)));
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia, enumerateDevices: vi.fn() } });
    const recorder = new MicrophoneRecorder({ requestMs: 10 });
    await expect(recorder.start(() => {})).rejects.toThrow('не отвечает');
    await sleep(70);
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it('stops both late streams when the device and fallback requests time out', async () => {
    const first = fakeStream();
    const second = fakeStream();
    let calls = 0;
    const getUserMedia = vi.fn(() => {
      calls += 1;
      const target = calls === 1 ? first.stream : second.stream;
      return new Promise<MediaStream>(resolve => setTimeout(() => resolve(target), 30 + calls * 20));
    });
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia, enumerateDevices: vi.fn() } });
    const recorder = new MicrophoneRecorder({ requestMs: 10 });
    await expect(recorder.start(() => {}, () => {}, { microphoneId: 'device-1', inputChannel: 'all' }))
      .rejects.toThrow('не отвечает');
    await sleep(120);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(first.track.stop).toHaveBeenCalledTimes(1);
    expect(second.track.stop).toHaveBeenCalledTimes(1);
  });

  it('stops a stream that resolves after dispose', async () => {
    const { track, stream } = fakeStream();
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn(() => new Promise<MediaStream>(resolve => setTimeout(() => resolve(stream), 40))),
        enumerateDevices: vi.fn(),
      },
    });
    const recorder = new MicrophoneRecorder({ requestMs: 200 });
    const start = recorder.start(() => {});
    await sleep(5);
    await recorder.dispose();
    await expect(start).rejects.toThrow('отменена');
    await sleep(60);
    expect(track.stop).toHaveBeenCalledTimes(1);
  });
});
