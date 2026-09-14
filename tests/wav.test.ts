import { describe, expect, it } from 'vitest';
import { encodeWav, validateWav } from '../src/shared/wav';
describe('audio contract', () => {
  it('encodes mono PCM16 at 16 kHz, clipping samples correctly', () => {
    const samples = new Float32Array(16000); samples.set([-2, -1, 0, 1, 2]);
    const buffer = encodeWav(samples); const view = new DataView(buffer);
    expect(() => validateWav(buffer)).not.toThrow();
    expect([0, 1, 2, 3, 4].map(i => view.getInt16(44 + i * 2, true))).toEqual([-32768, -32768, 0, 32767, 32767]);
  });
  it('rejects empty recordings, overlong audio and alternate sample rates', () => {
    expect(() => validateWav(encodeWav(new Float32Array()))).toThrow();
    expect(() => encodeWav(new Float32Array(16000 * 300 + 1))).toThrow();
    expect(() => encodeWav(new Float32Array(16000), 48000)).toThrow();
  });
  it('rejects forged WAV headers at the IPC boundary', () => {
    const buffer = encodeWav(new Float32Array(16000));
    new DataView(buffer).setUint32(40, 99999, true);
    expect(() => validateWav(buffer)).toThrow();
  });
});
