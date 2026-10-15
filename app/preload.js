const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tma', {
  on(channel, fn) {
    const wrapped = (_e, data) => fn(data);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  send(channel, data) {
    ipcRenderer.send(channel, data);
  },
  invoke(channel, data) {
    return ipcRenderer.invoke(channel, data);
  },
});
