import { contextBridge, ipcRenderer } from 'electron';
import type { OverlayApi, RecordingIndicator } from '../shared/contracts';
const api: OverlayApi = {
  state: () => ipcRenderer.invoke('overlay:state'),
  cancel: () => ipcRenderer.invoke('overlay:cancel'),
  onState: callback => {
    const listener = (_event: unknown, state: RecordingIndicator) => callback(state);
    ipcRenderer.on('overlay:state', listener);
    return () => ipcRenderer.removeListener('overlay:state', listener);
  },
};
contextBridge.exposeInMainWorld('vokeyraOverlay', api);
