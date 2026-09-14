import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

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
});
