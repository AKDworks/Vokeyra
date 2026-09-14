import type { Preferences } from '../shared/contracts';
import { CustomSelect, type SelectOption } from './custom-select';
import { playFeedback } from './audio-feedback';
import { setIcon } from './icons';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
export class SoundSettings {
  private preferences?: Preferences;
  private busy = false;
  private saving = false;
  private scanning = false;
  private preview?: AbortController;
  private devices: MediaDeviceInfo[] = [];
  private selects: Record<string, CustomSelect>;
  private toggles = { 'push-to-talk': 'pushToTalk', 'mute-recording': 'muteWhileRecording', 'audio-feedback': 'audioFeedback' } as const;

  constructor(private save: (patch: Partial<Preferences>) => Promise<void>, private report: (error: unknown) => void) {
    this.selects = {
      microphone: this.select('microphone', [{ value: 'default', label: 'По умолчанию' }], value => this.update({ microphoneId: value })),
      'input-channel': this.select('input-channel', [{ value: 'all', label: 'Все каналы' }, { value: 'first', label: 'Первый канал' }, { value: 'second', label: 'Второй канал' }], value => this.update({ inputChannel: value as Preferences['inputChannel'] })),
      'output-device': this.select('output-device', [{ value: 'default', label: 'По умолчанию' }], value => this.update({ outputDeviceId: value })),
    };
    for (const [id, key] of Object.entries(this.toggles)) el(id).onclick = () => this.update({ [key]: !this.preferences![key] });
    for (const id of ['refresh-inputs', 'refresh-outputs']) el(id).onclick = () => { void this.refreshDevices(true); };
    const volume = el<HTMLInputElement>('feedback-volume');
    volume.oninput = () => { el('volume-value').textContent = `${volume.value}%`; };
    volume.onchange = () => this.update({ feedbackVolume: Number(volume.value) });
    el('preview-feedback').onclick = () => {
      if (this.preview) { this.preview.abort(); return; }
      const controller = new AbortController(); this.preview = controller;
      const button = el<HTMLButtonElement>('preview-feedback');
      setIcon(button, 'pause'); button.setAttribute('aria-label', 'Остановить сигнал');
      void playFeedback('start', this.preferences!, controller.signal).catch(error => {
        if (!controller.signal.aborted) this.report(error);
      }).finally(() => {
        if (this.preview !== controller) return;
        this.preview = undefined;
        setIcon(button, 'play'); button.setAttribute('aria-label', 'Прослушать сигнал');
        this.renderDisabled();
      });
    };
    navigator.mediaDevices.addEventListener('devicechange', () => { void this.refreshDevices(false); });
  }
  private select(id: string, options: SelectOption[], onChange: (value: string) => void): CustomSelect {
    return new CustomSelect(el<HTMLButtonElement>(id), el(id + '-options'), options, onChange);
  }
  setValue(settings: Preferences): void {
    this.preferences = settings;
    for (const [id, key] of Object.entries(this.toggles)) el(id).setAttribute('aria-checked', String(settings[key]));
    el<HTMLInputElement>('feedback-volume').value = String(settings.feedbackVolume);
    el('volume-value').textContent = `${settings.feedbackVolume}%`;
    this.selects['input-channel']!.setValue(settings.inputChannel);
    this.renderDevices();
    this.renderDisabled();
  }
  setBusy(busy: boolean): void { this.busy = busy; this.renderDisabled(); }
  close(): void { this.preview?.abort(); Object.values(this.selects).forEach(select => select.close()); }
  private update(patch: Partial<Preferences>): void {
    if (this.busy || this.saving) return;
    this.saving = true; this.renderDisabled();
    void this.save(patch).catch(error => { this.report(error); if (this.preferences) this.setValue(this.preferences); })
      .finally(() => { this.saving = false; this.renderDisabled(); });
  }
  private renderDisabled(): void {
    const disabled = this.busy || this.saving || this.scanning || !this.preferences;
    Object.keys(this.toggles).forEach(id => { el<HTMLButtonElement>(id).disabled = disabled; });
    this.selects.microphone!.setDisabled(disabled);
    this.selects['input-channel']!.setDisabled(disabled);
    const feedbackDisabled = disabled || !this.preferences?.audioFeedback;
    if (feedbackDisabled) this.preview?.abort();
    this.selects['output-device']!.setDisabled(feedbackDisabled);
    for (const id of ['feedback-volume', 'refresh-outputs', 'preview-feedback']) el<HTMLInputElement>(id).disabled = feedbackDisabled;
    el<HTMLButtonElement>('refresh-inputs').disabled = disabled;
    for (const id of ['output-device', 'feedback-volume']) el(id).closest('.setting-row')!.classList.toggle('unavailable', !this.preferences?.audioFeedback);
  }
  private renderDevices(): void {
    if (!this.preferences) return;
    for (const [id, kind, selected] of [
      ['microphone', 'audioinput', this.preferences.microphoneId],
      ['output-device', 'audiooutput', this.preferences.outputDeviceId],
    ] as const) {
      const options = [{ value: 'default', label: 'По умолчанию' }, ...this.devices.filter(device => device.kind === kind && !['default', 'communications', ''].includes(device.deviceId))
        .map((device, index) => ({ value: device.deviceId, label: device.label || `${kind === 'audioinput' ? 'Микрофон' : 'Выход'} ${index + 1}` }))];
      if (!options.some(option => option.value === selected)) options.push({ value: selected, label: 'Устройство недоступно' });
      this.selects[id]!.setOptions(options); this.selects[id]!.setValue(selected);
    }
  }
  async refreshDevices(requestAccess: boolean): Promise<void> {
    if (this.scanning || this.busy) return;
    this.scanning = true; this.renderDisabled();
    try {
      if (requestAccess) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        stream.getTracks().forEach(track => track.stop());
      }
      this.devices = await navigator.mediaDevices.enumerateDevices();
      this.renderDevices();
    } catch { this.report(new Error('Не удалось получить список устройств. Проверьте доступ к микрофону в Windows.')); }
    finally { this.scanning = false; this.renderDisabled(); }
  }
}
