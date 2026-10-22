import type { AudioSource } from './contracts';

export interface AudioSourceOption {
  value: string;
  label: string;
}

/**
 * Build the Linux microphone list from capture-backend source names. Browser
 * device ids are opaque and must never be shown as if they were selectable
 * PulseAudio sources.
 */
export function microphoneSourceOptions(sources: AudioSource[], selected: string): AudioSourceOption[] {
  const options: AudioSourceOption[] = [
    { value: 'default', label: 'По умолчанию' },
    ...sources.map(source => ({ value: source.id, label: source.label })),
  ];
  if (!options.some(option => option.value === selected)) {
    options.push({ value: selected, label: 'Устройство недоступно' });
  }
  return options;
}
