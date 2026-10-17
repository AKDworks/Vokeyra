import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { microphoneLevel } from '../src/shared/audio-level';

function capture(channel: string, inputs: number[][]) {
  let Recorder: any;
  const messages: any[] = [];
  class Processor { port = { postMessage: (data: unknown) => messages.push(data), onmessage: (_: unknown) => {} }; }
  runInNewContext(readFileSync('src/renderer/recorder.worklet.js', 'utf8'), {
    AudioWorkletProcessor: Processor, Float32Array,
    registerProcessor: (_name: string, implementation: any) => { Recorder = implementation; },
  });
  const recorder = new Recorder({ processorOptions: { inputChannel: channel } });
  recorder.process([inputs.map(input => new Float32Array(input))]);
  recorder.port.onmessage({ data: 'stop' });
  return messages;
}
describe('microphone channel selection', () => {
  it.each([['all', [0, .5]], ['first', [1, .25]], ['second', [-1, .75]]])('captures %s channel', (channel, expected) => {
    const messages = capture(channel as string, [[1, .25], [-1, .75]]);
    expect([...messages[0]]).toEqual(expected);
    expect(messages[1]).toBe('stopped');
  });
  it('keeps mono input unchanged when averaging', () => {
    expect([...capture('all', [[.5, -.5]])[0]]).toEqual([.5, -.5]);
  });
  it('reports quiet speech before the PCM batch fills and leaves the audio unchanged', () => {
    const samples = Array.from({ length: 1600 }, (_, index) => index < 640 ? .005 : index < 1280 ? .03 : 0);
    const messages = capture('first', [samples]);
    const levels = messages.filter(message => message?.type === 'level');
    expect(levels).toHaveLength(2);
    expect(levels[0].rms).toBeCloseTo(.005, 5);
    expect(levels[1].rms).toBeCloseTo(.03, 5);
    expect(microphoneLevel(levels[0].rms)).toBeGreaterThan(.25);
    expect(microphoneLevel(levels[1].rms)).toBeGreaterThan(.6);
    const audio = messages.find(message => message instanceof Float32Array);
    expect([...audio!]).toEqual([...new Float32Array(samples)]);
  });
  it('keeps silence and invalid levels at zero and caps loud input', () => {
    expect([0, -.1, NaN].map(microphoneLevel)).toEqual([0, 0, 0]);
    expect(microphoneLevel(.0001)).toBe(0);
    expect(microphoneLevel(1)).toBe(1);
  });
});
