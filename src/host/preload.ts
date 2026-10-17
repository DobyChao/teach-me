import { contextBridge, ipcRenderer } from 'electron';
import type { Action, Bridge, Snapshot } from '../shared/protocol.ts';
const bridge: Bridge = {
  snapshot: () => ipcRenderer.invoke('companion:snapshot'),
  perform: (action: Action) => ipcRenderer.invoke('companion:action', action),
  subscribe: (listener: (state: Snapshot) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: Snapshot) => listener(state);
    ipcRenderer.on('companion:state', handler);
    return () => ipcRenderer.removeListener('companion:state', handler);
  },
};
contextBridge.exposeInMainWorld('companion', bridge);
