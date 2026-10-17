import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { DesktopApi, OverlayApi } from '../shared/contracts';

function subscribe<T>(event: string, callback: (payload: T) => void): () => void {
  let disposed = false;
  const ready = listen<T>(event, message => { if (!disposed) callback(message.payload); });
  void ready.catch(console.error);
  return () => { disposed = true; void ready.then(unlisten => unlisten()).catch(console.error); };
}
function encode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer); let value = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) value += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(value);
}
const call = <T = void>(method: string, ...args: unknown[]): Promise<T> =>
  invoke<T>('service_request', { method, args }).catch(error => { throw new Error(String(error)); });

const api: DesktopApi = {
  snapshot: () => call('app:snapshot'), saveSettings: value => call('settings:save', value),
  resetSettings: () => call('settings:reset'), refreshCatalog: () => call('catalog:refresh'),
  downloadModel: id => call('models:download', id), cancelDownload: id => call('models:cancel', id),
  deleteModel: id => call('models:delete', id), deleteAllModels: () => call('models:delete-all'),
  selectModel: id => call('models:select', id), openModelsFolder: () => call('models:open'),
  beginRecording: () => call('recording:begin'), prepareRecordingAudio: id => call('recording:prepare-audio', id),
  resetMicrophonePermission: () => call('microphone:reset-permission'), openMicrophoneSettings: () => call('microphone:open-settings'),
  finishRecordingAudio: id => call('recording:finish-audio', id),
  transcribe: (id, wav) => call('recording:transcribe', id, encode(wav)),
  cancelRecording: () => call('recording:cancel'), copyText: text => call('clipboard:copy', text),
  beginShortcutCapture: () => call('shortcut:begin-capture'), endShortcutCapture: () => call('shortcut:end-capture'),
  recordingLevel: (id, level, seconds) => { void call('recording:level', id, level, seconds).catch(console.error); },
  deleteHistory: id => call('history:delete', id), favoriteHistory: id => call('history:favorite', id),
  historyAudio: async id => { const data = atob(await call<string>('history:audio', id)); return Uint8Array.from(data, char => char.charCodeAt(0)).buffer; },
  retranscribeHistory: id => call('history:retranscribe', id), openRecordingsFolder: () => call('history:open'),
  clearHistory: () => call('history:clear'), openDataFolder: () => call('app:open-data'),
  openLicenses: () => call('app:open-licenses'), openGithub: () => call('app:open-github'),
  openModelLicense: id => call('models:license', id), startUpdate: () => call('app:start-update'),
  onCancel: callback => subscribe('recording:cancel-request', callback),
  onShortcutCaptureEnded: callback => subscribe('shortcut:capture-ended', callback),
  onToggle: callback => subscribe('recording:toggle', callback), onHold: callback => subscribe('recording:hold', callback),
  onDownload: callback => subscribe('models:progress', callback), onUpdateState: callback => subscribe('app:update-state', callback),
};
const overlay: OverlayApi = {
  state: () => call('overlay:state'), cancel: () => call('overlay:cancel'),
  onState: callback => subscribe('overlay:state', callback),
};
window.vokeyra = api;
window.vokeyraOverlay = overlay;
subscribe<string>('service:error', message => window.dispatchEvent(new CustomEvent('vokeyra-service-error', { detail: message })));
