/** Compress microphone amplitude into a useful display range for quiet speech. */
export function microphoneLevel(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0) return 0;
  const decibels = 20 * Math.log10(rms);
  return Math.max(0, Math.min(1, (decibels + 60) / 45));
}
