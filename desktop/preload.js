const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('toypad', Object.freeze({
  bootstrap: () => ipcRenderer.invoke('toypad:bootstrap'),
  create: (input) => ipcRenderer.invoke('toypad:create', input),
  importTags: () => ipcRenderer.invoke('toypad:import'),
  place: (input) => ipcRenderer.invoke('toypad:place', input),
  remove: (input) => ipcRenderer.invoke('toypad:remove', input),
  move: (input) => ipcRenderer.invoke('toypad:move', input),
  probe: (input) => ipcRenderer.invoke('toypad:probe', input),
  exportTag: (input) => ipcRenderer.invoke('toypad:export', input),
  openHelp: () => ipcRenderer.invoke('toypad:help'),
  openDataFolder: () => ipcRenderer.invoke('toypad:folder'),
  onState: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('toypad:state', listener);
    return () => ipcRenderer.removeListener('toypad:state', listener);
  },
}));
