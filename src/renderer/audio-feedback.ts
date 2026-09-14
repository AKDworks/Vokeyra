import { encodeWav } from '../shared/wav';
import type { Settings } from '../shared/contracts';

/** Original short tones, generated locally. No microphone monitoring or audio assets. */
export async function playFeedback(kind: 'start' | 'stop', settings: Pick<Settings, 'audioFeedback' | 'outputDeviceId' | 'feedbackVolume'>, signal?: AbortSignal): Promise<void> {
  if (!settings.audioFeedback || settings.feedbackVolume === 0 || signal?.aborted) return;
  const samples = new Float32Array(3200);
  for (let i = 0; i < samples.length; i++) {
    const part = Math.floor(i / 1600);
    const frequency = (kind === 'start' ? [580, 780] : [780, 580])[part]!;
    const local = i % 1600;
    const envelope = Math.min(1, local / 160, (1599 - local) / 320);
    samples[i] = Math.sin(2 * Math.PI * frequency * local / 16000) * envelope * .2;
  }
  const url = URL.createObjectURL(new Blob([encodeWav(samples)], { type: 'audio/wav' }));
  const audio = new Audio(url);
  audio.volume = settings.feedbackVolume / 100;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onAbort = () => {};
  try {
    await audio.setSinkId(settings.outputDeviceId === 'default' ? '' : settings.outputDeviceId);
    if (signal?.aborted) return;
    await new Promise<void>((resolve, reject) => {
      onAbort = () => { audio.pause(); resolve(); };
      signal?.addEventListener('abort', onAbort, { once: true });
      timeout = setTimeout(() => reject(new Error('Устройство вывода не отвечает.')), 2000);
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error('Не удалось воспроизвести сигнал.'));
      void audio.play().catch(reject);
    });
  } finally {
    signal?.removeEventListener('abort', onAbort);
    clearTimeout(timeout); audio.pause(); audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(url);
  }
}
