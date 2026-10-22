import { host } from './host';
import type { RecordingIndicator } from '../shared/contracts';

export class RecordingOverlay {
  state: RecordingIndicator = { phase: 'starting', level: 0, seconds: 0 };
  private position: 'top' | 'bottom' = 'bottom';
  private mode: 'none' | 'minimal' | 'realtime' = 'realtime';
  setPosition(position: 'top' | 'bottom'): void { this.position = position; }
  setLanguage(appLanguage: 'ru' | 'en'): void { this.state.appLanguage = appLanguage; this.publish(); }
  setMode(mode: 'none' | 'minimal' | 'realtime'): void { this.mode = mode; if (mode === 'none') this.hide(); this.publish(); }
  show(): void { if (this.mode !== 'none') void host('overlay:show', this.position).catch(console.error); }
  hide(): void { void host('overlay:hide').catch(console.error); }
  update(state: RecordingIndicator): void { this.state = { ...state, appLanguage: this.state.appLanguage }; this.publish(); }
  private publish(): void {
    this.state.overlayMode = this.mode === 'minimal' ? 'minimal' : 'realtime';
    // Rust renders a native indicator on Linux and forwards the same state to
    // the WebView overlay on other platforms.
    void host('overlay:update', this.state).catch(console.error);
  }
}
