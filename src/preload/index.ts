import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi, DownloadState } from '../shared/contracts';
const api: DesktopApi = {
  snapshot: () => ipcRenderer.invoke('app:snapshot'),
  saveSettings: value => ipcRenderer.invoke('settings:save', value),
  refreshCatalog: () => ipcRenderer.invoke('catalog:refresh'),
  downloadModel: id => ipcRenderer.invoke('models:download', id),
  cancelDownload: id => ipcRenderer.invoke('models:cancel', id),
  deleteModel: id => ipcRenderer.invoke('models:delete', id),
  selectModel: id => ipcRenderer.invoke('models:select', id),
  openModelsFolder: () => ipcRenderer.invoke('models:open'),
  beginRecording: () => ipcRenderer.invoke('recording:begin'),
  prepareRecordingAudio: id => ipcRenderer.invoke('recording:prepare-audio', id),
  finishRecordingAudio: id => ipcRenderer.invoke('recording:finish-audio', id),
  transcribe: (id, wav) => ipcRenderer.invoke('recording:transcribe', id, wav),
  cancelRecording: () => ipcRenderer.invoke('recording:cancel'),
  copyText: text => ipcRenderer.invoke('clipboard:copy', text),
  beginShortcutCapture: () => ipcRenderer.invoke('shortcut:begin-capture'),
  endShortcutCapture: () => ipcRenderer.invoke('shortcut:end-capture'),
  recordingLevel: (id, level, seconds) => ipcRenderer.send('recording:level', id, level, seconds),
  deleteHistory: id => ipcRenderer.invoke('history:delete', id),
  favoriteHistory: id => ipcRenderer.invoke('history:favorite', id),
  historyAudio: id => ipcRenderer.invoke('history:audio', id),
  retranscribeHistory: id => ipcRenderer.invoke('history:retranscribe', id),
  openRecordingsFolder: () => ipcRenderer.invoke('history:open'),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  openDataFolder: () => ipcRenderer.invoke('app:open-data'),
  openGithub: () => ipcRenderer.invoke('app:open-github'),
  onCancel: callback => {
    const listener = () => callback(); ipcRenderer.on('recording:cancel-request', listener);
    return () => ipcRenderer.removeListener('recording:cancel-request', listener);
  },
  onShortcutCaptureEnded: callback => {
    const listener = () => callback(); ipcRenderer.on('shortcut:capture-ended', listener);
    return () => ipcRenderer.removeListener('shortcut:capture-ended', listener);
  },
  onToggle: callback => {
    const listener = () => callback(); ipcRenderer.on('recording:toggle', listener);
    return () => ipcRenderer.removeListener('recording:toggle', listener);
  },
  onHold: callback => {
    const listener = (_event: unknown, pressed: boolean) => callback(pressed); ipcRenderer.on('recording:hold', listener);
    return () => ipcRenderer.removeListener('recording:hold', listener);
  },
  onDownload: callback => {
    const listener = (_event: unknown, state: DownloadState) => callback(state); ipcRenderer.on('models:progress', listener);
    return () => ipcRenderer.removeListener('models:progress', listener);
  },
};
contextBridge.exposeInMainWorld('vokeyra', api);
