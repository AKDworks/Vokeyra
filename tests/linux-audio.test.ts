import { describe, expect, it } from 'vitest';
import { pcm16StereoToMono } from '../src/main/platform/linux-audio';

function stereo(left: number, right: number, frames: number): Buffer {
  const buffer = Buffer.alloc(frames * 4);
  for (let index = 0; index < frames; index++) {
    buffer.writeInt16LE(Math.round(left * 32767), index * 4);
    buffer.writeInt16LE(Math.round(right * 32767), index * 4 + 2);
  }
  return buffer;
}

describe('Linux service-side audio capture', () => {
  it('selects the requested channel and averages without clipping', () => {
    const data = stereo(0.5, 1, 4);
    expect([...pcm16StereoToMono(data, 'first')]).toEqual([...new Float32Array(4).fill(0.5)]);
    for (const sample of pcm16StereoToMono(data, 'second')) expect(sample).toBeCloseTo(1, 4);
    for (const sample of pcm16StereoToMono(data, 'all')) expect(sample).toBeCloseTo(0.75, 4);
  });

  it('ignores an incomplete final frame', () => {
    const data = Buffer.concat([stereo(0.25, 0.5, 2), Buffer.from([1, 2, 3])]);
    expect(pcm16StereoToMono(data, 'all')).toHaveLength(2);
  });
});
