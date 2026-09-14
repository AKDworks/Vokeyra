import { MAX_RECORDING_SECONDS } from './contracts';
export function encodeWav(samples: Float32Array, sampleRate = 16000): ArrayBuffer {
  if (sampleRate !== 16000 || samples.length > 16000 * MAX_RECORDING_SECONDS) throw new Error('Нужен звук 16 кГц, до 5 минут.');
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(44 + i * 2, value < 0 ? value * 32768 : value * 32767, true);
  }
  return buffer;
}
export function validateWav(buffer: ArrayBuffer): void {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 44 + 3200 || buffer.byteLength > 44 + 32000 * MAX_RECORDING_SECONDS) throw new Error('Запишите от 0,1 секунды до 5 минут.');
  const v = new DataView(buffer);
  const tag = (offset: number, text: string) => [...text].every((c, i) => v.getUint8(offset + i) === c.charCodeAt(0));
  if (!tag(0, 'RIFF') || !tag(8, 'WAVE') || !tag(12, 'fmt ') || !tag(36, 'data') ||
    v.getUint32(4, true) !== buffer.byteLength - 8 || v.getUint32(16, true) !== 16 ||
    v.getUint16(20, true) !== 1 || v.getUint16(22, true) !== 1 || v.getUint32(24, true) !== 16000 ||
    v.getUint32(28, true) !== 32000 || v.getUint16(32, true) !== 2 || v.getUint16(34, true) !== 16 ||
    v.getUint32(40, true) !== buffer.byteLength - 44 || buffer.byteLength % 2 !== 0) throw new Error('Ожидается WAV PCM16 mono 16 кГц.');
}
