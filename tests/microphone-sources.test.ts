import { describe, expect, it } from 'vitest';
import { microphoneSourceOptions } from '../src/shared/audio-sources';

const sources = [
  { id: 'alsa_input.usb-fifine', label: 'fifine Microphone' },
  { id: 'alsa_input.pci', label: 'Built-in Audio' },
];

describe('Linux microphone source options', () => {
  it('selects the second capture-backend source by its stable id', () => {
    const options = microphoneSourceOptions(sources, 'alsa_input.pci');
    expect(options).toContainEqual({ value: 'alsa_input.pci', label: 'Built-in Audio' });
    expect(options.filter(option => option.value === 'alsa_input.pci')).toHaveLength(1);
  });

  it('shows an unavailable marker for a stale browser device id', () => {
    const stale = 'a'.repeat(64);
    const options = microphoneSourceOptions(sources, stale);
    expect(options.at(-1)).toEqual({ value: stale, label: 'Устройство недоступно' });
  });

  it('keeps the default source available even when no backend sources were listed', () => {
    expect(microphoneSourceOptions([], 'default')).toEqual([{ value: 'default', label: 'По умолчанию' }]);
  });
});
